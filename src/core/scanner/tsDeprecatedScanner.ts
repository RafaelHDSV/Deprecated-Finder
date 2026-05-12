import * as ts from 'typescript'
import { DeprecatedItem } from '../model/DeprecatedItem'
import { parseSuggestion, parseSuggestionModule } from './suggestionParser'
import { resolveImportInfo } from './importResolver'

export function scanFileForDeprecated(
  _filePath: string,
  program: ts.Program,
  sourceFile: ts.SourceFile
): DeprecatedItem[] {
  const fsPath = sourceFile.fileName
  const usageItems = collectUsageDeprecated(fsPath, program, sourceFile)
  const declItems = collectDeclarationSiteDeprecated(fsPath, program, sourceFile)
  const byId = new Map<string, DeprecatedItem>()
  for (const d of declItems) {
    byId.set(d.id, d)
  }
  for (const u of usageItems) {
    byId.set(u.id, u)
  }
  return Array.from(byId.values())
}

/**
 * References to symbols whose declarations carry @deprecated (calls, props, etc.).
 */
function collectUsageDeprecated(
  fsPath: string,
  program: ts.Program,
  sourceFile: ts.SourceFile
): DeprecatedItem[] {
  const checker = program.getTypeChecker()
  const deprecatedItems: DeprecatedItem[] = []
  const seen = new Set<string>()

  function visit(node: ts.Node) {
    if (!ts.isIdentifier(node)) {
      ts.forEachChild(node, visit)
      return
    }

    // Skip identifiers that name declarations (function foo, const foo, import { foo })
    if (isDeclarationName(node)) {
      ts.forEachChild(node, visit)
      return
    }

    let deprecatedTag: ts.JSDocTag | undefined
    let symbol: ts.Symbol | undefined

    if (isCallSite(node)) {
      // For function/method calls, check only the *specific resolved overload*.
      // This prevents false positives from functions that have both deprecated
      // and non-deprecated overloads (e.g. React.createElement).
      deprecatedTag = getCallSiteDeprecatedTag(node, checker)
      if (!deprecatedTag) {
        ts.forEachChild(node, visit)
        return
      }
      symbol = checker.getSymbolAtLocation(node) ?? undefined
    } else {
      // Property refs, JSX attributes, variables, etc. Prefer the checker symbol,
      // then resolve JSX attribute names via the component's props type — e.g.
      // <Modal destroyOnClose /> where @deprecated lives on ModalProps in .d.ts
      // (getSymbolAtLocation on the attribute name often does not surface that).
      symbol = checker.getSymbolAtLocation(node) ?? undefined
      deprecatedTag = undefined

      if (symbol) {
        deprecatedTag = findDeprecatedTag(symbol.getDeclarations() ?? [])
        if (!deprecatedTag) {
          const aliasedSymbol = tryFollowAlias(symbol, checker)
          if (aliasedSymbol && aliasedSymbol !== symbol) {
            deprecatedTag = findDeprecatedTag(aliasedSymbol.getDeclarations() ?? [])
            if (deprecatedTag) {
              symbol = aliasedSymbol
            }
          }
        }
      }

      if (!deprecatedTag) {
        const jsxProp = tryJsxAttributePropertySymbol(node, checker)
        if (jsxProp) {
          symbol = jsxProp
          deprecatedTag = findDeprecatedTag(jsxProp.getDeclarations() ?? [])
          if (!deprecatedTag) {
            const aliasProp = tryFollowAlias(jsxProp, checker)
            if (aliasProp && aliasProp !== jsxProp) {
              deprecatedTag = findDeprecatedTag(aliasProp.getDeclarations() ?? [])
              if (deprecatedTag) {
                symbol = aliasProp
              }
            }
          }
        }
      }

      if (!deprecatedTag || !symbol) {
        ts.forEachChild(node, visit)
        return
      }
    }

    const rawMessage = readTagText(deprecatedTag)
    const suggestion = parseSuggestion(rawMessage ?? '')
    const suggestedModule = parseSuggestionModule(rawMessage ?? '')

    const start = node.getStart()
    const end = node.getEnd()
    const startPos = sourceFile.getLineAndCharacterOfPosition(start)
    const endPos = sourceFile.getLineAndCharacterOfPosition(end)

    const symbolName = symbol?.getName() ?? node.text
    const id = `${symbolName}-${sourceFile.fileName}-${startPos.line}-${startPos.character}`

    if (!seen.has(id)) {
      seen.add(id)
      const importInfo = symbol
        ? resolveImportInfo(sourceFile, symbol, suggestedModule)
        : undefined

      deprecatedItems.push({
        id,
        name: symbolName,
        filePath: fsPath,
        line: startPos.line + 1,
        column: startPos.character + 1,
        endLine: endPos.line + 1,
        endColumn: endPos.character + 1,
        message: rawMessage?.trim() || 'This API is deprecated',
        suggestion,
        importInfo,
        source: 'jsdoc'
      })
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return deprecatedItems
}

/**
 * Declaration sites marked @deprecated (skipped by the usage visitor because
 * the identifier names the declaration). Surfaces APIs you just marked without
 * needing a call site in the same file.
 */
function collectDeclarationSiteDeprecated(
  fsPath: string,
  program: ts.Program,
  sourceFile: ts.SourceFile
): DeprecatedItem[] {
  const checker = program.getTypeChecker()
  const out: DeprecatedItem[] = []
  const seen = new Set<string>()

  function addSite(
    nameNode: ts.Identifier | ts.PrivateIdentifier,
    declForTags: ts.Node,
    forcedTag?: ts.JSDocTag
  ) {
    const deprecatedTag = forcedTag ?? findDeprecatedTag([declForTags])
    if (!deprecatedTag) {
      return
    }

    const rawMessage = readTagText(deprecatedTag)
    const suggestion = parseSuggestion(rawMessage ?? '')
    const suggestedModule = parseSuggestionModule(rawMessage ?? '')
    const symbol = checker.getSymbolAtLocation(nameNode) ?? undefined
    const symbolName = symbol?.getName() ?? nameNode.text

    const start = nameNode.getStart()
    const end = nameNode.getEnd()
    const startPos = sourceFile.getLineAndCharacterOfPosition(start)
    const endPos = sourceFile.getLineAndCharacterOfPosition(end)

    const id = `${symbolName}-${sourceFile.fileName}-${startPos.line}-${startPos.character}`
    if (seen.has(id)) {
      return
    }
    seen.add(id)

    const importInfo = symbol
      ? resolveImportInfo(sourceFile, symbol, suggestedModule)
      : undefined

    out.push({
      id,
      name: symbolName,
      filePath: fsPath,
      line: startPos.line + 1,
      column: startPos.character + 1,
      endLine: endPos.line + 1,
      endColumn: endPos.character + 1,
      message: rawMessage?.trim() || 'This API is deprecated',
      suggestion,
      importInfo,
      source: 'jsdoc'
    })
  }

  function walkDecl(node: ts.Node) {
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) {
          continue
        }
        const tag = findDeprecatedTag([decl]) ?? findDeprecatedTag([node])
        if (tag) {
          addSite(decl.name, decl, tag)
        }
      }
    } else if (ts.isFunctionDeclaration(node) && node.name) {
      addSite(node.name, node)
    } else if (ts.isFunctionExpression(node) && node.name) {
      addSite(node.name, node)
    } else if (ts.isClassDeclaration(node) && node.name) {
      addSite(node.name, node)
    } else if (ts.isInterfaceDeclaration(node) && node.name) {
      addSite(node.name, node)
    } else if (ts.isTypeAliasDeclaration(node) && node.name) {
      addSite(node.name, node)
    } else if (ts.isEnumDeclaration(node) && node.name) {
      addSite(node.name, node)
    } else if (ts.isEnumMember(node) && ts.isIdentifier(node.name)) {
      addSite(node.name, node)
    } else if (ts.isModuleDeclaration(node) && node.name && ts.isIdentifier(node.name)) {
      addSite(node.name, node)
    } else if (ts.isMethodDeclaration(node) && node.name && ts.isIdentifier(node.name)) {
      addSite(node.name, node)
    } else if (ts.isMethodSignature(node) && ts.isIdentifier(node.name)) {
      addSite(node.name, node)
    } else if (ts.isPropertyDeclaration(node) && node.name && ts.isIdentifier(node.name)) {
      addSite(node.name, node)
    } else if (ts.isPropertySignature(node) && ts.isIdentifier(node.name)) {
      addSite(node.name, node)
    } else if (ts.isGetAccessorDeclaration(node) && node.name && ts.isIdentifier(node.name)) {
      addSite(node.name, node)
    } else if (ts.isSetAccessorDeclaration(node) && node.name && ts.isIdentifier(node.name)) {
      addSite(node.name, node)
    } else if (ts.isParameter(node) && ts.isIdentifier(node.name)) {
      addSite(node.name, node)
    } else if (ts.isTypeParameterDeclaration(node) && ts.isIdentifier(node.name)) {
      addSite(node.name, node)
    }

    ts.forEachChild(node, walkDecl)
  }

  walkDecl(sourceFile)
  return out
}

/**
 * Returns true when the identifier is used as the callee (or part of the
 * callee) of a call expression — i.e. it's being called, not just referenced.
 * Examples: foo(), obj.foo(), new Foo()
 */
function isCallSite(node: ts.Identifier): boolean {
  const parent = node.parent
  if (!parent) {
    return false
  }

  // foo()
  if (ts.isCallExpression(parent) && parent.expression === node) {
    return true
  }

  // new Foo()
  if (ts.isNewExpression(parent) && parent.expression === node) {
    return true
  }

  // obj.method() — check the name part of the PropertyAccess
  if (
    ts.isPropertyAccessExpression(parent) &&
    parent.name === node &&
    ts.isCallExpression(parent.parent) &&
    parent.parent.expression === parent
  ) {
    return true
  }

  return false
}

/**
 * For identifiers in call position, resolves the exact overload that was
 * selected by the type checker and checks if THAT specific declaration is
 * deprecated. Returns the @deprecated JSDocTag or undefined.
 */
function getCallSiteDeprecatedTag(
  node: ts.Identifier,
  checker: ts.TypeChecker
): ts.JSDocTag | undefined {
  const parent = node.parent
  if (!parent) {
    return undefined
  }

  let callOrNew: ts.CallExpression | ts.NewExpression | undefined

  if (ts.isCallExpression(parent) && parent.expression === node) {
    callOrNew = parent
  } else if (ts.isNewExpression(parent) && parent.expression === node) {
    callOrNew = parent
  } else if (
    ts.isPropertyAccessExpression(parent) &&
    parent.name === node &&
    ts.isCallExpression(parent.parent) &&
    parent.parent.expression === parent
  ) {
    callOrNew = parent.parent
  }

  if (!callOrNew) {
    return undefined
  }

  try {
    const signature = checker.getResolvedSignature(callOrNew)
    if (!signature) {
      return undefined
    }

    const decl = signature.declaration
    if (!decl) {
      return undefined
    }

    const tags = ts.getJSDocTags(decl)
    return tags.find((t) => t.tagName.text === 'deprecated')
  } catch {
    return undefined
  }
}

function findDeprecatedTag(nodes: readonly ts.Node[]): ts.JSDocTag | undefined {
  for (const node of nodes) {
    const tags = ts.getJSDocTags(node)
    const tag = tags.find((t) => t.tagName.text === 'deprecated')
    if (tag) {
      return tag
    }
  }
  return undefined
}

/**
 * For `<Comp propName />`, `getSymbolAtLocation(propName)` often misses the
 * library PropertySignature that carries `@deprecated`. Resolve `propName`
 * on the apparent type of the JSX tag instead.
 */
function tryJsxAttributePropertySymbol(
  node: ts.Identifier,
  checker: ts.TypeChecker
): ts.Symbol | undefined {
  const parent = node.parent
  if (!ts.isJsxAttribute(parent) || parent.name !== node) {
    return undefined
  }
  const attrs = parent.parent
  if (!ts.isJsxAttributes(attrs)) {
    return undefined
  }
  const opening = attrs.parent
  if (!ts.isJsxOpeningElement(opening) && !ts.isJsxSelfClosingElement(opening)) {
    return undefined
  }
  const tagName = opening.tagName
  if (!ts.isJsxTagNameExpression(tagName) || ts.isJsxNamespacedName(tagName)) {
    return undefined
  }

  try {
    const tagType = checker.getTypeAtLocation(tagName)
    return findPropertySymbolOnType(checker, tagType, node.text)
  } catch {
    return undefined
  }
}

function findPropertySymbolOnType(
  checker: ts.TypeChecker,
  type: ts.Type,
  propName: string
): ts.Symbol | undefined {
  const escaped = ts.escapeLeadingUnderscores(propName)

  const tryOne = (ty: ts.Type): ts.Symbol | undefined => {
    const app = checker.getApparentType(ty)
    const direct = app.getProperty(propName)
    if (direct) {
      return direct
    }
    for (const p of checker.getPropertiesOfType(app)) {
      if (p.escapedName === escaped) {
        return p
      }
    }
    return undefined
  }

  let sym = tryOne(type)
  if (sym) {
    return sym
  }

  const app = checker.getApparentType(type)
  if (app.flags & ts.TypeFlags.Union) {
    for (const u of (app as ts.UnionType).types) {
      sym = tryOne(u)
      if (sym) {
        return sym
      }
    }
  }
  if (app.flags & ts.TypeFlags.Intersection) {
    for (const t of (app as ts.IntersectionType).types) {
      sym = tryOne(t)
      if (sym) {
        return sym
      }
    }
  }

  return undefined
}

function tryFollowAlias(
  symbol: ts.Symbol,
  checker: ts.TypeChecker
): ts.Symbol | undefined {
  try {
    if (symbol.flags & ts.SymbolFlags.Alias) {
      return checker.getAliasedSymbol(symbol)
    }
  } catch {
    // ignore
  }
  return undefined
}

function readTagText(tag: ts.JSDocTag): string | undefined {
  if (!tag.comment) {
    return undefined
  }

  if (typeof tag.comment === 'string') {
    return tag.comment
  }

  return tag.comment
    .map((part) => {
      if (typeof part === 'string') {
        return part
      }

      if (
        ts.isJSDocLink(part) ||
        ts.isJSDocLinkCode(part) ||
        ts.isJSDocLinkPlain(part)
      ) {
        const name = part.name ? entityNameToString(part.name) : ''
        const text = part.text ?? ''
        return `${name}${text ? ' ' + text : ''}`.trim()
      }

      return part.text ?? ''
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function entityNameToString(name: ts.EntityName | ts.JSDocMemberName): string {
  if (ts.isIdentifier(name)) {
    return name.text
  }
  if (ts.isQualifiedName(name)) {
    return `${entityNameToString(name.left)}.${name.right.text}`
  }
  return name.getText()
}

function isDeclarationName(node: ts.Identifier): boolean {
  const parent = node.parent
  if (!parent) {
    return false
  }

  if (
    (ts.isFunctionDeclaration(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isInterfaceDeclaration(parent) ||
      ts.isEnumDeclaration(parent) ||
      ts.isTypeAliasDeclaration(parent) ||
      ts.isModuleDeclaration(parent) ||
      ts.isVariableDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isMethodSignature(parent) ||
      ts.isImportSpecifier(parent) ||
      ts.isImportClause(parent) ||
      ts.isNamespaceImport(parent) ||
      ts.isExportSpecifier(parent) ||
      ts.isBindingElement(parent)) &&
    parent.name === node
  ) {
    return true
  }

  return false
}

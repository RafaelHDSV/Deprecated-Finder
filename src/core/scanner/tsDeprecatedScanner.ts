import * as ts from 'typescript'
import { DeprecatedItem } from '../model/DeprecatedItem'
import { parseSuggestion, parseSuggestionModule } from './suggestionParser'
import { resolveImportInfo } from './importResolver'

export function scanFileForDeprecated(
  filePath: string,
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
      // For everything else (property access, JSX attributes, variable refs, etc.)
      // check all declarations of the resolved symbol. This is the path that
      // detects JSX props like <Modal destroyOnClose> when destroyOnClose is
      // marked @deprecated in the component's props interface.
      symbol = checker.getSymbolAtLocation(node) ?? undefined
      if (!symbol) {
        ts.forEachChild(node, visit)
        return
      }

      const declarations = symbol.getDeclarations() ?? []
      deprecatedTag = findDeprecatedTag(declarations)

      // Fallback: check the type's symbol for JSX attributes and property accesses
      // where getSymbolAtLocation may return an alias instead of the real property.
      if (!deprecatedTag) {
        const aliasedSymbol = tryFollowAlias(symbol, checker)
        if (aliasedSymbol && aliasedSymbol !== symbol) {
          deprecatedTag = findDeprecatedTag(aliasedSymbol.getDeclarations() ?? [])
          if (deprecatedTag) {
            symbol = aliasedSymbol
          }
        }
      }

      if (!deprecatedTag) {
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
        filePath,
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

function findDeprecatedTag(
  declarations: readonly ts.Declaration[]
): ts.JSDocTag | undefined {
  for (const decl of declarations) {
    const tags = ts.getJSDocTags(decl)
    const tag = tags.find((t) => t.tagName.text === 'deprecated')
    if (tag) {
      return tag
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

import * as ts from 'typescript'
import { DeprecatedItem } from '../model/DeprecatedItem'
import { parseSuggestion, parseSuggestionModule } from './suggestionParser'
import { resolveImportInfo } from './importResolver'

/**
 * Lists *uses* of symbols whose declaration carries `@deprecated` (calls, prop refs,
 * JSX attributes, plain identifier references). The declaration site itself is the
 * **origin** of the deprecation — not a thing to fix — so it is intentionally not
 * surfaced here. The usage visitor already skips declaration names via
 * `isDeclarationName`, so declaring a deprecated API in a file does **not** produce
 * an item for that file unless the file also uses the symbol.
 */
export function scanFileForDeprecated(
  _filePath: string,
  program: ts.Program,
  sourceFile: ts.SourceFile
): DeprecatedItem[] {
  return collectUsageDeprecated(sourceFile.fileName, program, sourceFile)
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
        const resolved = unwrapAliasChain(symbol, checker)
        deprecatedTag = findDeprecatedTag(resolved.getDeclarations() ?? [])
        if (deprecatedTag) {
          symbol = resolved
        }
      }

      if (!deprecatedTag) {
        const jsxProp = tryJsxAttributePropertySymbol(node, checker)
        if (jsxProp) {
          const resolvedProp = unwrapAliasChain(jsxProp, checker)
          symbol = resolvedProp
          deprecatedTag = findDeprecatedTag(resolvedProp.getDeclarations() ?? [])
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
 * Props type for JSX components: `FunctionComponent<P>` only exposes `P` via
 * the first parameter of the call signature — `getProperty` on the
 * intersection `FC<P> & { static methods }` does not see members of `P`
 * (e.g. antd `Modal`).
 */
function tryGetJsxCallPropsParameterType(
  checker: ts.TypeChecker,
  componentType: ts.Type,
  contextNode: ts.Node
): ts.Type | undefined {
  const apparent = checker.getApparentType(componentType)

  for (const sig of apparent.getCallSignatures()) {
    const first = sig.parameters[0]
    if (first) {
      return checker.getTypeOfSymbolAtLocation(first, contextNode)
    }
  }

  for (const sig of apparent.getConstructSignatures()) {
    const first = sig.parameters[0]
    if (first) {
      return checker.getTypeOfSymbolAtLocation(first, contextNode)
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
    const tagType = checker.getApparentType(checker.getTypeAtLocation(tagName))
    const propsType = tryGetJsxCallPropsParameterType(checker, tagType, tagName)
    if (propsType) {
      const fromProps = findPropertySymbolOnType(checker, propsType, node.text)
      if (fromProps) {
        return fromProps
      }
    }
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

/**
 * Local import symbols (e.g. `ChartBar`) often only list `ImportSpecifier` as
 * their declaration, without `@deprecated`; the tag lives on the aliased
 * export in node_modules. Walk the alias chain (re-exports, etc.).
 */
function unwrapAliasChain(symbol: ts.Symbol, checker: ts.TypeChecker): ts.Symbol {
  let current: ts.Symbol = symbol
  for (let depth = 0; depth < 16; depth++) {
    if (!(current.flags & ts.SymbolFlags.Alias)) {
      return current
    }
    try {
      const next = checker.getAliasedSymbol(current)
      if (!next || next === current) {
        return current
      }
      current = next
    } catch {
      return current
    }
  }
  return current
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

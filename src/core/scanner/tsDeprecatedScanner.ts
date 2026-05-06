import * as ts from 'typescript'
import { DeprecatedItem } from '../model/DeprecatedItem'
import {
  parseSuggestion,
  parseSuggestionModule
} from './suggestionParser'
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

    if (isDeclarationName(node)) {
      ts.forEachChild(node, visit)
      return
    }

    const symbol = checker.getSymbolAtLocation(node)
    if (!symbol) {
      ts.forEachChild(node, visit)
      return
    }

    const declarations = symbol.getDeclarations() ?? []
    const deprecatedTag = findDeprecatedTag(declarations)

    if (!deprecatedTag) {
      ts.forEachChild(node, visit)
      return
    }

    const rawMessage = readTagText(deprecatedTag)
    const suggestion = parseSuggestion(rawMessage ?? '')
    const suggestedModule = parseSuggestionModule(rawMessage ?? '')

    const start = node.getStart()
    const end = node.getEnd()
    const startPos = sourceFile.getLineAndCharacterOfPosition(start)
    const endPos = sourceFile.getLineAndCharacterOfPosition(end)

    const id = `${symbol.getName()}-${sourceFile.fileName}-${startPos.line}-${startPos.character}`

    if (!seen.has(id)) {
      seen.add(id)
      const importInfo = resolveImportInfo(sourceFile, symbol, suggestedModule)

      deprecatedItems.push({
        id,
        name: symbol.getName(),
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

      if (ts.isJSDocLink(part) || ts.isJSDocLinkCode(part) || ts.isJSDocLinkPlain(part)) {
        const name = part.name ? entityNameToString(part.name) : ''
        const text = part.text ?? ''
        return `${name}${text ? ' ' + text : ''}`.trim()
      }

      return part.text ?? ''
    })
    .join(' ')
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
      ts.isExportSpecifier(parent)) &&
    parent.name === node
  ) {
    return true
  }

  return false
}

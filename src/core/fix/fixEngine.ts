import * as ts from 'typescript'
import * as vscode from 'vscode'
import { DeprecatedItem } from '../model/DeprecatedItem'

export interface FixSummary {
  fixed: number
  skipped: number
  files: number
}

export type FixAllProgress = (update: {
  phase: 'editing' | 'saving'
  current: number
  total: number
}) => void

/**
 * Applies a fix for a single deprecated item. Returns true when something was
 * actually applied. The current scope rewrites:
 *   - the identifier occurrence pointed by the item's range
 *   - the matching named/default import in the same file (when applicable)
 */
export async function fixItem(item: DeprecatedItem): Promise<boolean> {
  if (!item.suggestion) {
    vscode.window.showWarningMessage(
      `Deprecated Finder: no replacement available for "${item.name}".`
    )
    return false
  }

  const uri = vscode.Uri.file(item.filePath)
  const document = await vscode.workspace.openTextDocument(uri)
  const edit = new vscode.WorkspaceEdit()

  const applied = buildEditForItem(document, item, edit)
  if (!applied) {
    return false
  }

  const success = await vscode.workspace.applyEdit(edit)
  if (!success) {
    return false
  }

  await document.save()
  return true
}

/**
 * Applies fixes for several deprecated items. Items without suggestion are
 * skipped. Edits are batched per file to avoid offset drift.
 */
export async function fixAll(
  items: DeprecatedItem[],
  onProgress?: FixAllProgress
): Promise<FixSummary> {
  const fixable = items.filter((item) => item.suggestion)
  const skipped = items.length - fixable.length

  if (fixable.length === 0) {
    return { fixed: 0, skipped, files: 0 }
  }

  const byFile = groupByFile(fixable)
  const edit = new vscode.WorkspaceEdit()
  const touchedDocs: vscode.TextDocument[] = []
  let fixed = 0
  const fileEntries = Array.from(byFile.entries())
  const totalFiles = fileEntries.length

  for (const [filePath, fileItems] of fileEntries) {
    const uri = vscode.Uri.file(filePath)
    const document = await vscode.workspace.openTextDocument(uri)
    touchedDocs.push(document)

    const sortedItems = sortItemsForBatch(fileItems)
    const importsHandled = new Set<string>()

    for (const item of sortedItems) {
      const importKey = item.importInfo
        ? `${item.importInfo.moduleSpecifier}:${item.importInfo.importedName}`
        : ''

      const handleImport =
        item.importInfo && !importsHandled.has(importKey)

      if (buildEditForItem(document, item, edit, handleImport)) {
        fixed++
        if (handleImport && importKey) {
          importsHandled.add(importKey)
        }
      }
    }

    onProgress?.({
      phase: 'editing',
      current: touchedDocs.length,
      total: totalFiles
    })
  }

  const success = await vscode.workspace.applyEdit(edit)
  if (!success) {
    return { fixed: 0, skipped, files: 0 }
  }

  const saveTotal = touchedDocs.length
  for (let i = 0; i < touchedDocs.length; i++) {
    await touchedDocs[i].save()
    onProgress?.({
      phase: 'saving',
      current: i + 1,
      total: saveTotal
    })
  }

  return { fixed, skipped, files: touchedDocs.length }
}

function buildEditForItem(
  document: vscode.TextDocument,
  item: DeprecatedItem,
  edit: vscode.WorkspaceEdit,
  handleImport = true
): boolean {
  if (!item.suggestion) {
    return false
  }

  const jsxMigration = tryJsxDottedDeprecationMigration(document, item, item.suggestion)
  if (jsxMigration) {
    edit.replace(document.uri, jsxMigration.range, jsxMigration.newText)
    if (handleImport && item.importInfo) {
      const importEdit = buildImportEdit(document, item)
      if (importEdit) {
        edit.replace(document.uri, importEdit.range, importEdit.newText)
      }
    }
    return true
  }

  const range = identifierRange(document, item)
  if (!range) {
    return false
  }

  edit.replace(document.uri, range, item.suggestion)

  if (handleImport && item.importInfo) {
    const importEdit = buildImportEdit(document, item)
    if (importEdit) {
      edit.replace(document.uri, importEdit.range, importEdit.newText)
    }
  }

  return true
}

/**
 * Ant Design-style deprecations suggest `mask.closable` instead of `maskClosable`.
 * In JSX, `mask.closable={x}` is invalid; use `mask={{ closable: x }}`.
 * Same idea: `showSearch.filterOption` → `showSearch={{ filterOption: … }}`.
 *
 * If the root prop (e.g. `mask`) already exists on the same element, we skip —
 * merging object literals is not implemented.
 */
function tryJsxDottedDeprecationMigration(
  document: vscode.TextDocument,
  item: DeprecatedItem,
  suggestion: string
): { range: vscode.Range; newText: string } | undefined {
  if (!isJsxLikeFile(document.fileName)) {
    return undefined
  }

  const segments = suggestion.split('.').filter((s) => /^[A-Za-z_$][\w$]*$/.test(s))
  if (segments.length < 2) {
    return undefined
  }

  const sourceFile = ts.createSourceFile(
    document.fileName,
    document.getText(),
    ts.ScriptTarget.Latest,
    true,
    detectScriptKind(document.fileName)
  )

  const pos = document.offsetAt(new vscode.Position(item.line - 1, item.column - 1))
  const attr = findJsxAttributeContainingPosition(sourceFile, pos)
  if (!attr || !ts.isIdentifier(attr.name) || attr.name.text !== item.name) {
    return undefined
  }

  const rootProp = segments[0]
  const nested = segments.slice(1)
  const parentAttrs = attr.parent
  if (!ts.isJsxAttributes(parentAttrs)) {
    return undefined
  }

  if (hasSiblingJsxAttributeNamed(parentAttrs, rootProp, attr)) {
    return undefined
  }

  const valueSource = jsxAttributeValueExpressionText(sourceFile, attr)
  const objectInner = buildNestedObjectLiteralSource(nested, valueSource)
  const newText = `${rootProp}={{ ${objectInner} }}`

  const start = document.positionAt(attr.getStart(sourceFile))
  const end = document.positionAt(attr.getEnd())
  return { range: new vscode.Range(start, end), newText }
}

function isJsxLikeFile(fileName: string): boolean {
  return /\.(tsx|jsx)$/i.test(fileName)
}

function findJsxAttributeContainingPosition(
  sourceFile: ts.SourceFile,
  pos: number
): ts.JsxAttribute | undefined {
  let hit: ts.JsxAttribute | undefined
  const visit = (node: ts.Node) => {
    if (hit) {
      return
    }
    if (ts.isJsxAttribute(node)) {
      const name = node.name
      if (ts.isIdentifier(name) && pos >= name.getStart(sourceFile) && pos < node.end) {
        hit = node
        return
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return hit
}

function hasSiblingJsxAttributeNamed(
  attrs: ts.JsxAttributes,
  name: string,
  except: ts.JsxAttribute
): boolean {
  for (const p of attrs.properties) {
    if (!ts.isJsxAttribute(p) || p === except) {
      continue
    }
    if (ts.isIdentifier(p.name) && p.name.text === name) {
      return true
    }
  }
  return false
}

function jsxAttributeValueExpressionText(
  sourceFile: ts.SourceFile,
  attr: ts.JsxAttribute
): string {
  if (!attr.initializer) {
    return 'true'
  }
  if (ts.isJsxExpression(attr.initializer)) {
    const expr = attr.initializer.expression
    if (expr === undefined) {
      return 'undefined'
    }
    return expr.getText(sourceFile)
  }
  return attr.initializer.getText(sourceFile)
}

/** `['closable'], '!loading'` → `closable: !loading`; deeper paths nest `{ }`. */
function buildNestedObjectLiteralSource(path: string[], valueExpr: string): string {
  if (path.length === 1) {
    return `${path[0]}: ${valueExpr}`
  }
  return `${path[0]}: { ${buildNestedObjectLiteralSource(path.slice(1), valueExpr)} }`
}

function identifierRange(
  document: vscode.TextDocument,
  item: DeprecatedItem
): vscode.Range | undefined {
  const start = new vscode.Position(item.line - 1, item.column - 1)
  const end = new vscode.Position(item.endLine - 1, item.endColumn - 1)
  const range = new vscode.Range(start, end)

  const text = document.getText(range)
  if (text === item.name) {
    return range
  }

  const lineText = document.lineAt(item.line - 1).text
  const fallbackIndex = lineText.indexOf(item.name, item.column - 1)
  if (fallbackIndex < 0) {
    return undefined
  }

  return new vscode.Range(
    new vscode.Position(item.line - 1, fallbackIndex),
    new vscode.Position(item.line - 1, fallbackIndex + item.name.length)
  )
}

interface ImportEdit {
  range: vscode.Range
  newText: string
}

function buildImportEdit(
  document: vscode.TextDocument,
  item: DeprecatedItem
): ImportEdit | undefined {
  if (!item.importInfo || !item.suggestion) {
    return undefined
  }

  const sourceFile = ts.createSourceFile(
    document.fileName,
    document.getText(),
    ts.ScriptTarget.Latest,
    true,
    detectScriptKind(document.fileName)
  )

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) {
      continue
    }
    if (!ts.isStringLiteral(statement.moduleSpecifier)) {
      continue
    }

    const currentModule = statement.moduleSpecifier.text
    const originalRange = nodeRange(document, statement)
    const newStatement = rewriteImport(statement, item, currentModule)

    if (newStatement && newStatement.text !== statement.getText()) {
      return { range: originalRange, newText: newStatement.text }
    }
  }

  return undefined
}

interface RewrittenImport {
  text: string
}

function rewriteImport(
  statement: ts.ImportDeclaration,
  item: DeprecatedItem,
  currentModule: string
): RewrittenImport | undefined {
  if (!item.importInfo || !item.suggestion) {
    return undefined
  }

  const clause = statement.importClause
  if (!clause) {
    return undefined
  }

  const targetModule = item.importInfo.moduleSpecifier
  const moduleChanged = targetModule !== currentModule

  if (clause.name && clause.name.text === item.importInfo.importedName) {
    const text = `import ${item.suggestion}${
      clause.namedBindings ? ', ' + printNamedBindings(clause.namedBindings) : ''
    } from '${targetModule}'`
    return { text }
  }

  const namedBindings = clause.namedBindings
  if (!namedBindings) {
    return undefined
  }

  if (ts.isNamespaceImport(namedBindings)) {
    if (namedBindings.name.text !== item.importInfo.importedName) {
      return undefined
    }
    const text = `import${
      clause.name ? ' ' + clause.name.text + ',' : ''
    } * as ${item.suggestion} from '${targetModule}'`
    return { text }
  }

  if (!ts.isNamedImports(namedBindings)) {
    return undefined
  }

  const elements = namedBindings.elements
  let touched = false

  const newElements = elements.map((element) => {
    const localName = element.name.text
    const importedName = element.propertyName?.text ?? localName

    if (importedName === item.importInfo!.importedName) {
      touched = true
      return item.suggestion!
    }

    return element.getText()
  })

  if (!touched && !moduleChanged) {
    return undefined
  }

  const namedPart = `{ ${newElements.join(', ')} }`
  const defaultPart = clause.name ? `${clause.name.text}, ` : ''
  const text = `import ${defaultPart}${namedPart} from '${targetModule}'`
  return { text }
}

function printNamedBindings(bindings: ts.NamedImportBindings): string {
  if (ts.isNamespaceImport(bindings)) {
    return `* as ${bindings.name.text}`
  }
  const items = bindings.elements.map((el) => el.getText())
  return `{ ${items.join(', ')} }`
}

function nodeRange(
  document: vscode.TextDocument,
  node: ts.Node
): vscode.Range {
  const start = document.positionAt(node.getStart())
  const end = document.positionAt(node.getEnd())
  return new vscode.Range(start, end)
}

function detectScriptKind(fileName: string): ts.ScriptKind {
  if (fileName.endsWith('.tsx')) {
    return ts.ScriptKind.TSX
  }
  if (fileName.endsWith('.jsx')) {
    return ts.ScriptKind.JSX
  }
  if (fileName.endsWith('.js')) {
    return ts.ScriptKind.JS
  }
  return ts.ScriptKind.TS
}

function groupByFile(items: DeprecatedItem[]): Map<string, DeprecatedItem[]> {
  const map = new Map<string, DeprecatedItem[]>()
  for (const item of items) {
    const existing = map.get(item.filePath) ?? []
    existing.push(item)
    map.set(item.filePath, existing)
  }
  return map
}

function sortItemsForBatch(items: DeprecatedItem[]): DeprecatedItem[] {
  return [...items].sort((a, b) => {
    if (a.line !== b.line) {
      return b.line - a.line
    }
    return b.column - a.column
  })
}

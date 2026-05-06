import * as ts from 'typescript'
import * as vscode from 'vscode'
import { DeprecatedItem } from '../model/DeprecatedItem'

export interface FixSummary {
  fixed: number
  skipped: number
  files: number
}

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
export async function fixAll(items: DeprecatedItem[]): Promise<FixSummary> {
  const fixable = items.filter((item) => item.suggestion)
  const skipped = items.length - fixable.length

  if (fixable.length === 0) {
    return { fixed: 0, skipped, files: 0 }
  }

  const byFile = groupByFile(fixable)
  const edit = new vscode.WorkspaceEdit()
  const touchedDocs: vscode.TextDocument[] = []
  let fixed = 0

  for (const [filePath, fileItems] of byFile.entries()) {
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
  }

  const success = await vscode.workspace.applyEdit(edit)
  if (!success) {
    return { fixed: 0, skipped, files: 0 }
  }

  for (const doc of touchedDocs) {
    await doc.save()
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

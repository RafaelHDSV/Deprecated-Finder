import * as ts from 'typescript'
import * as vscode from 'vscode'
import { DeprecatedItem, ImportInfo } from '../model/DeprecatedItem'
import { logScanWarning } from '../../logging/deprecatedFinderLog'

type FixableItem = DeprecatedItem & { importInfo: ImportInfo; suggestion: string }

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

  const applied = buildIdentifierEditForItem(document, item, edit)
  if (!applied) {
    return false
  }

  if (isFixableItem(item)) {
    buildImportEditsForFile(document, [item], edit)
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
 * skipped. Each file is opened, edited, **applied**, and **saved** in sequence
 * so a failure on one file does not leave hundreds of dirty buffers unsaved
 * and does not block persisting earlier files.
 *
 * Imports are handled in **one pass per file**: every deprecated symbol in the
 * same `ImportDeclaration` is renamed in a single combined edit. Doing it
 * per-item would queue N overlapping `edit.replace` calls on the same import
 * range, which `applyEdit` rejects (the source of the early-Fix-all hang).
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
  const fileEntries = Array.from(byFile.entries())
  const totalFiles = fileEntries.length
  let fixed = 0
  let filesSaved = 0

  for (let fi = 0; fi < fileEntries.length; fi++) {
    const [filePath, fileItems] = fileEntries[fi]
    onProgress?.({
      phase: 'editing',
      current: fi + 1,
      total: totalFiles
    })

    const uri = vscode.Uri.file(filePath)
    const document = await vscode.workspace.openTextDocument(uri)
    const edit = new vscode.WorkspaceEdit()
    const sortedItems = sortItemsForBatch(fileItems)
    let itemsApplied = 0

    for (const item of sortedItems) {
      if (buildIdentifierEditForItem(document, item, edit)) {
        itemsApplied++
      }
    }

    const importable = fileItems.filter(isFixableItem)
    if (importable.length > 0) {
      buildImportEditsForFile(document, importable, edit)
    }

    if (itemsApplied === 0) {
      continue
    }

    const appliedOk = await vscode.workspace.applyEdit(edit)
    if (!appliedOk) {
      logScanWarning(`Fix all: applyEdit was rejected for ${filePath}`)
      continue
    }

    try {
      const saved = await document.save()
      if (!saved) {
        logScanWarning(
          `Fix all: document.save() returned false for ${filePath} (buffer may still be dirty)`
        )
        continue
      }
      fixed += itemsApplied
      filesSaved++
      onProgress?.({
        phase: 'saving',
        current: filesSaved,
        total: totalFiles
      })
    } catch (e) {
      logScanWarning(
        `Fix all: document.save() failed for ${filePath}: ${
          e instanceof Error ? e.message : String(e)
        }`
      )
    }
  }

  return { fixed, skipped, files: filesSaved }
}

function isFixableItem(item: DeprecatedItem): item is FixableItem {
  return Boolean(item.importInfo && item.suggestion)
}

function buildIdentifierEditForItem(
  document: vscode.TextDocument,
  item: DeprecatedItem,
  edit: vscode.WorkspaceEdit
): boolean {
  if (!item.suggestion) {
    return false
  }

  const jsxMigration = tryJsxDottedDeprecationMigration(document, item, item.suggestion)
  if (jsxMigration && jsxMigration.length > 0) {
    for (const patch of sortJsxPatchesDescending(jsxMigration)) {
      edit.replace(document.uri, patch.range, patch.newText)
    }
    return true
  }

  const range = identifierRange(document, item)
  if (!range) {
    return false
  }

  edit.replace(document.uri, range, item.suggestion)
  return true
}

interface JsxPatch {
  range: vscode.Range
  newText: string
}

function sortJsxPatchesDescending(patches: JsxPatch[]): JsxPatch[] {
  return [...patches].sort((a, b) => {
    if (a.range.start.line !== b.range.start.line) {
      return b.range.start.line - a.range.start.line
    }
    return b.range.start.character - a.range.start.character
  })
}

function rangeForTsNode(
  document: vscode.TextDocument,
  sourceFile: ts.SourceFile,
  node: ts.Node
): vscode.Range {
  const start = document.positionAt(node.getStart(sourceFile))
  const end = document.positionAt(node.getEnd())
  return new vscode.Range(start, end)
}

/**
 * Ant Design-style deprecations suggest `mask.closable` instead of `maskClosable`.
 * In JSX, `mask.closable={x}` is invalid; use `mask={{ closable: x }}`.
 * Same idea: `showSearch.filterOption` → `showSearch={{ filterOption: … }}`.
 *
 * When the root prop already exists (e.g. `showSearch` shorthand next to
 * `filterOption`), we remove the leaf attribute and merge into the root
 * (`showSearch={{ filterOption: … }}` or merge into an existing object literal).
 */
function tryJsxDottedDeprecationMigration(
  document: vscode.TextDocument,
  item: DeprecatedItem,
  suggestion: string
): JsxPatch[] | undefined {
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

  const valueSource = jsxAttributeValueExpressionText(sourceFile, attr)
  const objectInner = buildNestedObjectLiteralSource(nested, valueSource)
  const leafRange = rangeForTsNode(document, sourceFile, attr)
  const rootSibling = findSiblingJsxAttribute(parentAttrs, rootProp, attr)

  if (!rootSibling) {
    const newText = `${rootProp}={{ ${objectInner} }}`
    return [{ range: leafRange, newText }]
  }

  const merged = tryMergeJsxDottedIntoExistingRoot(
    document,
    sourceFile,
    rootProp,
    rootSibling,
    nested,
    objectInner,
    valueSource,
    leafRange
  )
  return merged
}

function tryMergeJsxDottedIntoExistingRoot(
  document: vscode.TextDocument,
  sourceFile: ts.SourceFile,
  rootProp: string,
  rootSibling: ts.JsxAttribute,
  nested: string[],
  objectInner: string,
  valueSource: string,
  leafRange: vscode.Range
): JsxPatch[] | undefined {
  const rootRange = rangeForTsNode(document, sourceFile, rootSibling)

  if (!rootSibling.initializer) {
    return sortJsxPatchesDescending([
      { range: leafRange, newText: '' },
      { range: rootRange, newText: `${rootProp}={{ ${objectInner} }}` }
    ])
  }

  if (ts.isStringLiteral(rootSibling.initializer)) {
    return undefined
  }

  if (ts.isJsxExpression(rootSibling.initializer)) {
    const expr = rootSibling.initializer.expression
    if (expr === undefined) {
      return sortJsxPatchesDescending([
        { range: leafRange, newText: '' },
        { range: rootRange, newText: `${rootProp}={{ ${objectInner} }}` }
      ])
    }
    if (expr.kind === ts.SyntaxKind.TrueKeyword) {
      return sortJsxPatchesDescending([
        { range: leafRange, newText: '' },
        { range: rootRange, newText: `${rootProp}={{ ${objectInner} }}` }
      ])
    }
    if (ts.isObjectLiteralExpression(expr)) {
      const mergedObj = mergeLeafIntoObjectLiteral(sourceFile, expr, nested, valueSource)
      if (!mergedObj) {
        return undefined
      }
      const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed })
      const printed = printer.printNode(ts.EmitHint.Expression, mergedObj, sourceFile)
      return sortJsxPatchesDescending([
        { range: leafRange, newText: '' },
        { range: rootRange, newText: `${rootProp}={${printed}}` }
      ])
    }
    return undefined
  }

  return undefined
}

function mergeLeafIntoObjectLiteral(
  sourceFile: ts.SourceFile,
  obj: ts.ObjectLiteralExpression,
  nested: string[],
  valueExprString: string
): ts.ObjectLiteralExpression | undefined {
  if (nested.length !== 1) {
    return undefined
  }
  const key = nested[0]
  const parsed = parseExpressionFragment(valueExprString, sourceFile)
  if (!parsed) {
    return undefined
  }

  const kept = obj.properties.filter((p) => {
    if (!ts.isPropertyAssignment(p)) {
      return true
    }
    const name = p.name
    if (ts.isIdentifier(name) && name.text === key) {
      return false
    }
    if (ts.isStringLiteral(name) && name.text === key) {
      return false
    }
    return true
  })

  const newProp = ts.factory.createPropertyAssignment(ts.factory.createIdentifier(key), parsed)
  return ts.factory.updateObjectLiteralExpression(obj, [...kept, newProp])
}

function parseExpressionFragment(text: string, _sourceFile: ts.SourceFile): ts.Expression | undefined {
  const wrapped = `const __df_frag = (${text});\n`
  const frag = ts.createSourceFile(
    '__df_frag.tsx',
    wrapped,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )
  const stmt = frag.statements[0]
  if (!ts.isVariableStatement(stmt)) {
    return undefined
  }
  const decl = stmt.declarationList.declarations[0]
  const init = decl.initializer
  if (!init) {
    return undefined
  }
  if (ts.isParenthesizedExpression(init)) {
    return init.expression
  }
  return init
}

function findSiblingJsxAttribute(
  attrs: ts.JsxAttributes,
  name: string,
  except: ts.JsxAttribute
): ts.JsxAttribute | undefined {
  for (const p of attrs.properties) {
    if (!ts.isJsxAttribute(p) || p === except) {
      continue
    }
    if (ts.isIdentifier(p.name) && p.name.text === name) {
      return p
    }
  }
  return undefined
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

/**
 * Aggregates every fixable item in `items` by the import statement that owns
 * its symbol, then rewrites each statement **once** with all renames combined.
 *
 * Why a single combined edit per statement: with N deprecated symbols sharing
 * one `ImportDeclaration`, the previous per-item code queued N `edit.replace`
 * calls on the same range. `applyEdit` rejected the conflicting set and the
 * whole file was silently skipped — which manifested as Fix all "hanging" right
 * after the loading banner appeared.
 *
 * A statement is only rewritten when at least one of its locally bound names
 * matches a deprecated symbol; unrelated imports are left untouched (fixes the
 * earlier "wrong import got rewritten" bug where the first NamedImports
 * statement in source order was hijacked just because the suggested module
 * differed from its current module).
 */
function buildImportEditsForFile(
  document: vscode.TextDocument,
  items: FixableItem[],
  edit: vscode.WorkspaceEdit
): void {
  if (items.length === 0) {
    return
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

    const clause = statement.importClause
    if (!clause) {
      continue
    }

    const matching = collectItemsForStatement(items, clause)
    if (matching.length === 0) {
      continue
    }

    const renames = new Map<string, string>()
    for (const it of matching) {
      renames.set(it.importInfo.importedName, it.suggestion)
    }
    const targetModule = matching[0].importInfo.moduleSpecifier

    const rewritten = rewriteImport(statement, renames, targetModule)
    if (!rewritten || rewritten.text === statement.getText()) {
      continue
    }

    edit.replace(document.uri, nodeRange(document, statement), rewritten.text)
  }
}

/**
 * Items whose `importedName` is actually bound by this `ImportClause`
 * (default binding, namespace binding, or any named element).
 */
function collectItemsForStatement(
  items: FixableItem[],
  clause: ts.ImportClause
): FixableItem[] {
  const localBindings = new Set<string>()

  if (clause.name) {
    localBindings.add(clause.name.text)
  }

  const namedBindings = clause.namedBindings
  if (namedBindings) {
    if (ts.isNamespaceImport(namedBindings)) {
      localBindings.add(namedBindings.name.text)
    } else if (ts.isNamedImports(namedBindings)) {
      for (const el of namedBindings.elements) {
        localBindings.add(el.propertyName?.text ?? el.name.text)
      }
    }
  }

  return items.filter((it) => localBindings.has(it.importInfo.importedName))
}

interface RewrittenImport {
  text: string
}

/**
 * Rebuilds a single `import` declaration applying all renames in `renames`
 * (key = original imported name, value = replacement). Returns `undefined`
 * when no element of the statement matched — leaving the original text
 * untouched is critical to avoid corrupting unrelated imports.
 */
function rewriteImport(
  statement: ts.ImportDeclaration,
  renames: Map<string, string>,
  targetModule: string
): RewrittenImport | undefined {
  const clause = statement.importClause
  if (!clause) {
    return undefined
  }

  let touched = false
  let defaultPart: string | undefined
  let namedBindingsPart: string | undefined

  if (clause.name) {
    const replacement = renames.get(clause.name.text)
    if (replacement) {
      defaultPart = replacement
      touched = true
    } else {
      defaultPart = clause.name.text
    }
  }

  const namedBindings = clause.namedBindings
  if (namedBindings) {
    if (ts.isNamespaceImport(namedBindings)) {
      const replacement = renames.get(namedBindings.name.text)
      if (replacement) {
        namedBindingsPart = `* as ${replacement}`
        touched = true
      } else {
        namedBindingsPart = `* as ${namedBindings.name.text}`
      }
    } else if (ts.isNamedImports(namedBindings)) {
      const seenLocals = new Set<string>()
      const newElements: string[] = []
      for (const element of namedBindings.elements) {
        const importedName = element.propertyName?.text ?? element.name.text
        const replacement = renames.get(importedName)
        const localName = replacement ?? element.name.text
        const emit = replacement ?? element.getText()
        if (replacement) {
          touched = true
        }
        if (seenLocals.has(localName)) {
          continue
        }
        seenLocals.add(localName)
        newElements.push(emit)
      }
      if (newElements.length > 0) {
        namedBindingsPart = `{ ${newElements.join(', ')} }`
      }
    }
  }

  if (!touched) {
    return undefined
  }

  const segments: string[] = []
  if (defaultPart) {
    segments.push(defaultPart)
  }
  if (namedBindingsPart) {
    segments.push(namedBindingsPart)
  }

  if (segments.length === 0) {
    return undefined
  }

  const typeOnly = clause.isTypeOnly ? 'type ' : ''
  const text = `import ${typeOnly}${segments.join(', ')} from '${targetModule}'`
  return { text }
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

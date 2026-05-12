import * as vscode from 'vscode'
import { deprecatedStore } from '../core/state/deprecatedStore'
import { DeprecatedItem } from '../core/model/DeprecatedItem'

export class DeprecatedCodeActionProvider implements vscode.CodeActionProvider {
  public static readonly providedKinds = [vscode.CodeActionKind.QuickFix]

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection
  ): vscode.CodeAction[] {
    const items = deprecatedStore
      .getAll()
      .filter((item) => normalize(item.filePath) === normalize(document.fileName))

    const actions: vscode.CodeAction[] = []

    for (const item of items) {
      if (!item.suggestion) {
        continue
      }
      if (!intersectsItem(range, item)) {
        continue
      }

      const action = new vscode.CodeAction(
        quickFixTitle(item, document),
        vscode.CodeActionKind.QuickFix
      )
      action.command = {
        command: 'deprecatedFinder.fixItem',
        title: 'Apply deprecated fix',
        arguments: [item.id]
      }
      actions.push(action)
    }

    return actions
  }
}

function quickFixTitle(item: DeprecatedItem, document: vscode.TextDocument): string {
  const suggestion = item.suggestion ?? ''
  const isJsxFile = /\.(tsx|jsx)$/i.test(document.fileName)
  const dotted =
    isJsxFile &&
    /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/.test(suggestion)

  if (dotted) {
    return `Replace deprecated "${item.name}" with JSX object form (${suggestion} → ${suggestion.split('.')[0]}={{ … }})`
  }

  return `Replace deprecated "${item.name}" with "${suggestion}"`
}

function intersectsItem(
  range: vscode.Range | vscode.Selection,
  item: DeprecatedItem
): boolean {
  const itemRange = new vscode.Range(
    new vscode.Position(item.line - 1, item.column - 1),
    new vscode.Position(item.endLine - 1, item.endColumn - 1)
  )
  return Boolean(range.intersection(itemRange)) ||
    range.contains(itemRange) ||
    itemRange.contains(range)
}

function normalize(filePath: string): string {
  return filePath.replace(/\\/g, '/').toLowerCase()
}

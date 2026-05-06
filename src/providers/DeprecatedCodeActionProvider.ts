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
        `Replace deprecated "${item.name}" with "${item.suggestion}"`,
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

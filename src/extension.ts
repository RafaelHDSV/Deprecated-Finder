import * as path from 'path'
import * as vscode from 'vscode'
import {
  scanForDeprecated,
  scanSingleFile,
  invalidateProgramCache
} from './core/scanner/deprecatedScanner'
import { deprecatedStore } from './core/state/deprecatedStore'
import { fixAll, fixItem } from './core/fix/fixEngine'
import { DeprecatedViewProvider } from './providers/DeprecatedViewProvider'
import { DeprecatedCodeActionProvider } from './providers/DeprecatedCodeActionProvider'
import { openDeprecatedPanel } from './ui/deprecatedPanel'

const SUPPORTED_LANGUAGES: vscode.DocumentSelector = [
  { language: 'typescript', scheme: 'file' },
  { language: 'typescriptreact', scheme: 'file' },
  { language: 'javascript', scheme: 'file' },
  { language: 'javascriptreact', scheme: 'file' }
]

export function activate(context: vscode.ExtensionContext) {
  const provider = new DeprecatedViewProvider(context)

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      DeprecatedViewProvider.viewType,
      provider
    )
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('deprecatedFinder.scan', async () => {
      invalidateProgramCache()
      provider.setLoading(true)
      try {
        await scanForDeprecated((update) => {
          provider.postProgress(update)
        })
      } finally {
        provider.setLoading(false)
      }
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('deprecatedFinder.openPanel', () =>
      openDeprecatedPanel(context)
    )
  )

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'deprecatedFinder.fixItem',
      async (itemId: string) => {
        const item = deprecatedStore.getById(itemId)
        if (!item) {
          vscode.window.showWarningMessage(
            'Deprecated Finder: item no longer exists. Please re-scan.'
          )
          return
        }
        provider.setLoading(true)
        provider.postProgress({
          kind: 'indeterminate',
          message: 'Applying fix…',
          fileCount: 0
        })
        try {
          const ok = await fixItem(item)
          if (ok) {
            provider.postProgress({
              kind: 'indeterminate',
              message: 'Updating list for this file…',
              fileCount: 0
            })
            await scanSingleFile(item.filePath)
          }
        } finally {
          provider.setLoading(false)
        }
      }
    )
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('deprecatedFinder.fixAll', async () => {
      const items = deprecatedStore.getAll()
      provider.setLoading(true)
      provider.postProgress({
        kind: 'indeterminate',
        message: 'Applying fixes to the workspace…',
        fileCount: 0
      })
      try {
        const summary = await fixAll(items)
        vscode.window.showInformationMessage(
          `Deprecated Finder: fixed ${summary.fixed} occurrence(s) in ${summary.files} file(s).` +
            (summary.skipped > 0
              ? ` Skipped ${summary.skipped} item(s) without suggestion.`
              : '')
        )
        invalidateProgramCache()
        provider.postProgress({
          kind: 'indeterminate',
          message: 'Re-scanning workspace…',
          fileCount: 0
        })
        await scanForDeprecated((update) => {
          provider.postProgress(update)
        })
      } finally {
        provider.setLoading(false)
      }
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'deprecatedFinder.openFile',
      async (filePath: string, line: number) => {
        await openInEditor(filePath, line)
      }
    )
  )

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async (document) => {
      if (document.uri.scheme !== 'file') {
        return
      }
      if (!/\.(ts|tsx|js|jsx)$/i.test(document.fileName)) {
        return
      }
      const shortName = path.basename(document.fileName)
      provider.beginFileRescanActivity(shortName)
      try {
        await scanSingleFile(document.fileName)
      } catch (error) {
        console.error(
          '[Deprecated Finder] Failed to re-scan saved file',
          error
        )
      } finally {
        provider.endFileRescanActivity()
      }
    })
  )

  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      SUPPORTED_LANGUAGES,
      new DeprecatedCodeActionProvider(),
      { providedCodeActionKinds: DeprecatedCodeActionProvider.providedKinds }
    )
  )

  // Initial scan when the extension activates with an open workspace.
  if (vscode.workspace.workspaceFolders?.length) {
    provider.setLoading(true)
    scanForDeprecated((update) => {
      provider.postProgress(update)
    })
      .catch((error) => {
        console.error('[Deprecated Finder] Initial scan failed', error)
      })
      .finally(() => {
        provider.setLoading(false)
      })
  }
}

export function deactivate() {
  invalidateProgramCache()
  deprecatedStore.clear()
}

async function openInEditor(filePath: string, line: number) {
  const uri = vscode.Uri.file(filePath)
  const document = await vscode.workspace.openTextDocument(uri)
  const editor = await vscode.window.showTextDocument(document)

  const safeLine = Math.max(0, line - 1)
  const position = new vscode.Position(safeLine, 0)
  editor.selection = new vscode.Selection(position, position)
  editor.revealRange(
    new vscode.Range(position, position),
    vscode.TextEditorRevealType.InCenter
  )
}

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
import {
  registerDeprecatedFinderLog,
  logScanError
} from './logging/deprecatedFinderLog'

const SUPPORTED_LANGUAGES: vscode.DocumentSelector = [
  { language: 'typescript', scheme: 'file' },
  { language: 'typescriptreact', scheme: 'file' },
  { language: 'javascript', scheme: 'file' },
  { language: 'javascriptreact', scheme: 'file' }
]

export function activate(context: vscode.ExtensionContext) {
  registerDeprecatedFinderLog(context)

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
      provider.setLoading(true, 'Scanning workspace for deprecated APIs…')
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
    /**
     * After a fix, refresh that file in the store. If a full workspace scan is running,
     * `scanSingleFile` defers the store update until the global scan completes (see README).
     */
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
        provider.setLoading(true, 'Applying fix…')
        try {
          const ok = await fixItem(item)
          if (ok) {
            provider.postProgress({
              kind: 'indeterminate',
              message: 'Applying fix: refreshing this file in the list…',
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
    vscode.commands.registerCommand(
      'deprecatedFinder.fixAll',
      async (...args: unknown[]) => {
        const rawIds = args[0]
        let items = deprecatedStore.getAll()
        if (Array.isArray(rawIds) && rawIds.length > 0) {
          const idSet = new Set(
            rawIds.filter((x): x is string => typeof x === 'string' && x.length > 0)
          )
          items = items.filter((it) => idSet.has(it.id) && it.suggestion)
          if (items.length === 0) {
            vscode.window.showWarningMessage(
              'Deprecated Finder: no fixable items match the current filter.'
            )
            return
          }
        }
        provider.setLoading(true, 'Applying fixes to the workspace…')
        try {
          const summary = await fixAll(items, (p) => {
            const message =
              p.phase === 'editing'
                ? `Applying fixes: preparing edits (${p.current} / ${p.total} files)…`
                : `Applying fixes: saving (${p.current} / ${p.total} files)…`
            provider.postProgress({
              kind: 'indeterminate',
              message,
              fileCount: 0
            })
          })
          vscode.window.showInformationMessage(
            `Deprecated Finder: fixed ${summary.fixed} occurrence(s) in ${summary.files} file(s).` +
              (summary.skipped > 0
                ? ` Skipped ${summary.skipped} item(s) without suggestion.`
                : '')
          )
        } catch (error) {
          logScanError('[Deprecated Finder] Fix all failed', error)
          void vscode.window.showErrorMessage(
            'Deprecated Finder: Fix all stopped with an error. Check Output → Deprecated Finder for details.'
          )
        } finally {
          try {
            invalidateProgramCache()
            await scanForDeprecated((update) => {
              provider.postProgress(update)
            }, { narrative: 'post-fix' })
          } catch (scanError) {
            logScanError(
              '[Deprecated Finder] Post-fix workspace scan failed',
              scanError
            )
          }
          provider.setLoading(false)
        }
      }
    )
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
    /**
     * Save → incremental scan. If a full `scanForDeprecated` is in flight, the scanner
     * defers `updateFile` and flushes after the global `set` — see README "Scan behavior".
     */
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
        logScanError(
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
    provider.setLoading(true, 'Scanning workspace for deprecated APIs…')
    scanForDeprecated((update) => {
      provider.postProgress(update)
    })
      .catch((error) => {
        logScanError('[Deprecated Finder] Initial scan failed', error)
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

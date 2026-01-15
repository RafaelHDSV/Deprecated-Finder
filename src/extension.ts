import * as vscode from 'vscode'
import { scanForDeprecated } from './core/scanner/deprecatedScanner'
import { DeprecatedViewProvider } from './providers/DeprecatedViewProvider'

export function activate(context: vscode.ExtensionContext) {
  const provider = new DeprecatedViewProvider(context)

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      DeprecatedViewProvider.viewType,
      provider
    )
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('deprecatedFinder.open', async () => {
      await scanForDeprecated()
      provider.refresh()
    })
  )
}

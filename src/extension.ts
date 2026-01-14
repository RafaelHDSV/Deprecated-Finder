import * as vscode from 'vscode'
import { scanForDeprecated } from './core/scanner/deprecatedScanner'

export function activate(context: vscode.ExtensionContext) {
  console.log('Deprecated Finder activated')

  const disposable = vscode.commands.registerCommand(
    'deprecatedFinder.open',
    async () => {
      await scanForDeprecated()
    }
  )

  context.subscriptions.push(disposable)
}

export function deactivate() {}

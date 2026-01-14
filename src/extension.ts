import * as vscode from 'vscode'

export function activate(context: vscode.ExtensionContext) {
  console.log(
    'Congratulations, your extension "deprecated-finder" is now active!'
  )
  const disposable = vscode.commands.registerCommand(
    'deprecatedFinder.open',
    () => {
      vscode.window.showInformationMessage('Deprecated Finder is now active!')
    }
  )

  context.subscriptions.push(disposable)
}

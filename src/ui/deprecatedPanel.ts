import * as vscode from 'vscode'
import { deprecatedStore } from '../core/state/deprecatedStore'
import { getDeprecatedPanelHtml } from './deprecatedPanelHtml'

let panel: vscode.WebviewPanel | undefined
let unsubscribe: (() => void) | undefined

export function openDeprecatedPanel(_context: vscode.ExtensionContext) {
  if (panel) {
    panel.reveal(vscode.ViewColumn.One)
    return
  }

  panel = vscode.window.createWebviewPanel(
    'deprecatedFinder',
    'Deprecated Finder',
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true }
  )

  const render = () => {
    if (panel) {
      panel.webview.html = getDeprecatedPanelHtml(deprecatedStore.getAll())
    }
  }

  render()

  unsubscribe = deprecatedStore.onChange(render)

  panel.webview.onDidReceiveMessage((message) => {
    switch (message?.type) {
      case 'openFile':
        vscode.commands.executeCommand(
          'deprecatedFinder.openFile',
          message.filePath,
          message.line
        )
        return
      case 'fixItem':
        vscode.commands.executeCommand(
          'deprecatedFinder.fixItem',
          message.itemId
        )
        return
      case 'fixAll':
        vscode.commands.executeCommand('deprecatedFinder.fixAll')
        return
      case 'rescan':
        vscode.commands.executeCommand('deprecatedFinder.scan')
        return
    }
  })

  panel.onDidDispose(() => {
    unsubscribe?.()
    unsubscribe = undefined
    panel = undefined
  })
}

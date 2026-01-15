import * as vscode from 'vscode'
import { deprecatedStore } from '../core/state/deprecatedStore'
import { getDeprecatedPanelHtml } from './deprecatedPanelHtml'

let panel: vscode.WebviewPanel | undefined

export function openDeprecatedPanel(context: vscode.ExtensionContext) {
  if (panel) {
    panel.reveal(vscode.ViewColumn.One)
    return
  }

  panel = vscode.window.createWebviewPanel(
    'deprecatedFinder',
    'Deprecated Finder',
    vscode.ViewColumn.One,
    {
      enableScripts: true
    }
  )

  panel.webview.html = getDeprecatedPanelHtml(deprecatedStore.getAll())

  panel.onDidDispose(() => {
    panel = undefined
  })
}

import * as vscode from 'vscode'
import { deprecatedStore } from '../core/state/deprecatedStore'

export class DeprecatedViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'deprecatedFinder.view'

  constructor(private readonly context: vscode.ExtensionContext) {}

  private view?: vscode.WebviewView

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this.view = webviewView

    webviewView.webview.options = {
      enableScripts: true
    }

    webviewView.webview.html = this.getHtml()

    webviewView.webview.onDidReceiveMessage((message) => {
      if (message.type === 'openFile') {
        this.openFile(message.filePath, message.line)
      }
    })
  }

  public refresh() {
    if (!this.view) return

    this.view.webview.html = this.getHtml()
  }

  private getHtml(): string {
    const items = deprecatedStore.getAll()

    const listItems = items
      .map(
        (item) => `
        <li data-file="${item.filePath}" data-line="${item.line}">
          <strong>${item.name}</strong><br/>
          <small>${item.filePath}:${item.line}</small>
          <p>${item.message ?? ''}</p>
        </li>
      `
      )
      .join('')

    return `
      <!DOCTYPE html>
      <html lang="en">
      <body>
        <h2>Deprecated Finder</h2>
        <ul>${listItems}</ul>

        <script>
          const vscode = acquireVsCodeApi();

          document.querySelectorAll('li').forEach(li => {
            li.addEventListener('click', () => {
              vscode.postMessage({
                type: 'openFile',
                filePath: li.dataset.file,
                line: Number(li.dataset.line)
              });
            });
          });
        </script>
      </body>
      </html>
    `
  }

  private async openFile(filePath: string, line: number) {
    const uri = vscode.Uri.file(filePath)
    const document = await vscode.workspace.openTextDocument(uri)
    const editor = await vscode.window.showTextDocument(document)

    const position = new vscode.Position(line - 1, 0)
    editor.selection = new vscode.Selection(position, position)
    editor.revealRange(new vscode.Range(position, position))
  }
}

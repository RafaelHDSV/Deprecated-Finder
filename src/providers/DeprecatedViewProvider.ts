import * as vscode from 'vscode'
import { deprecatedStore } from '../core/state/deprecatedStore'
import { DeprecatedItem } from '../core/model/DeprecatedItem'

export class DeprecatedViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'deprecatedFinder.view'

  private view?: vscode.WebviewView
  private loading = false
  private storeUnsubscribe?: () => void

  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this.view = webviewView

    webviewView.webview.options = {
      enableScripts: true
    }

    this.storeUnsubscribe?.()
    this.storeUnsubscribe = deprecatedStore.onChange(() => this.refresh())

    webviewView.onDidDispose(() => {
      this.storeUnsubscribe?.()
      this.storeUnsubscribe = undefined
      this.view = undefined
    })

    webviewView.webview.onDidReceiveMessage((message) => {
      this.handleMessage(message)
    })

    this.refresh()
  }

  public refresh() {
    if (!this.view) {
      return
    }
    this.view.webview.html = this.getHtml()
  }

  public setLoading(loading: boolean) {
    this.loading = loading
    this.refresh()
  }

  private handleMessage(message: { type: string; [key: string]: unknown }) {
    switch (message.type) {
      case 'openFile':
        vscode.commands.executeCommand(
          'deprecatedFinder.openFile',
          message.filePath as string,
          message.line as number
        )
        return
      case 'fixItem':
        vscode.commands.executeCommand(
          'deprecatedFinder.fixItem',
          message.itemId as string
        )
        return
      case 'fixAll':
        vscode.commands.executeCommand('deprecatedFinder.fixAll')
        return
      case 'rescan':
        vscode.commands.executeCommand('deprecatedFinder.scan')
        return
    }
  }

  private getHtml(): string {
    const items = deprecatedStore.getAll()
    const fixableCount = items.filter((item) => item.suggestion).length

    const grouped = groupByFile(items)

    const fileSections = Array.from(grouped.entries())
      .map(([filePath, fileItems]) => renderFileSection(filePath, fileItems))
      .join('')

    const emptyState = items.length === 0 && !this.loading
      ? `<div class="empty">
           <p>No deprecated symbols found in this workspace yet.</p>
           <p class="hint">Save a supported file or click "Re-scan" to refresh.</p>
         </div>`
      : ''

    const loadingState = this.loading
      ? `<div class="loading"><span class="spinner"></span> Scanning workspace…</div>`
      : ''

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <style>${getStyles()}</style>
  </head>
  <body>
    <header class="toolbar">
      <div class="title">
        <strong>Deprecated Finder</strong>
        <span class="badge">${items.length}</span>
      </div>
      <div class="actions">
        <button class="btn ghost" data-action="rescan" ${
          this.loading ? 'disabled' : ''
        }>Re-scan</button>
        <button class="btn primary" data-action="fixAll" ${
          this.loading || fixableCount === 0 ? 'disabled' : ''
        }>Fix all (${fixableCount})</button>
      </div>
    </header>

    ${loadingState}
    ${emptyState}

    <div class="files">${fileSections}</div>

    <script>
      const vscode = acquireVsCodeApi();

      document.querySelectorAll('[data-action]').forEach(el => {
        el.addEventListener('click', (evt) => {
          evt.stopPropagation();
          const action = el.getAttribute('data-action');

          if (action === 'rescan') {
            vscode.postMessage({ type: 'rescan' });
            return;
          }
          if (action === 'fixAll') {
            vscode.postMessage({ type: 'fixAll' });
            return;
          }
          if (action === 'fixItem') {
            vscode.postMessage({
              type: 'fixItem',
              itemId: el.getAttribute('data-item-id')
            });
            return;
          }
          if (action === 'openFile') {
            vscode.postMessage({
              type: 'openFile',
              filePath: el.getAttribute('data-file'),
              line: Number(el.getAttribute('data-line'))
            });
            return;
          }
        });
      });
    </script>
  </body>
</html>`
  }
}

function groupByFile(items: DeprecatedItem[]): Map<string, DeprecatedItem[]> {
  const map = new Map<string, DeprecatedItem[]>()
  for (const item of items) {
    const existing = map.get(item.filePath) ?? []
    existing.push(item)
    map.set(item.filePath, existing)
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.line - b.line || a.column - b.column)
  }
  return map
}

function renderFileSection(
  filePath: string,
  items: DeprecatedItem[]
): string {
  const shortName = filePath.split(/[\\/]/).pop() ?? filePath
  const dir = filePath.replace(/[\\/][^\\/]*$/, '')

  const itemsHtml = items.map((item) => renderItem(item)).join('')

  return `
    <section class="file">
      <header class="file-header">
        <span class="file-name">${escapeHtml(shortName)}</span>
        <span class="file-dir" title="${escapeHtml(filePath)}">${escapeHtml(dir)}</span>
        <span class="file-count">${items.length}</span>
      </header>
      <ul class="items">${itemsHtml}</ul>
    </section>
  `
}

function renderItem(item: DeprecatedItem): string {
  const hasSuggestion = Boolean(item.suggestion)
  const suggestionHtml = hasSuggestion
    ? `<div class="suggestion">→ <code>${escapeHtml(item.suggestion!)}</code></div>`
    : `<div class="suggestion no-suggestion">No replacement suggested</div>`

  const fixButton = hasSuggestion
    ? `<button class="btn small primary" data-action="fixItem" data-item-id="${escapeAttr(
        item.id
      )}">Fix</button>`
    : `<button class="btn small disabled" disabled>Fix</button>`

  return `
    <li class="item">
      <div class="item-main"
           data-action="openFile"
           data-file="${escapeAttr(item.filePath)}"
           data-line="${item.line}">
        <div class="name"><code>${escapeHtml(item.name)}</code> <span class="loc">:${item.line}:${item.column}</span></div>
        ${suggestionHtml}
        ${item.message ? `<div class="message">${escapeHtml(item.message)}</div>` : ''}
      </div>
      <div class="item-actions">${fixButton}</div>
    </li>
  `
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeAttr(input: string): string {
  return escapeHtml(input)
}

function getStyles(): string {
  return `
    :root {
      color-scheme: light dark;
    }
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      margin: 0;
      padding: 0;
      font-size: 12px;
    }
    .toolbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 10px;
      border-bottom: 1px solid var(--vscode-panel-border);
      position: sticky;
      top: 0;
      background: var(--vscode-sideBar-background);
      z-index: 1;
    }
    .title { display: flex; align-items: center; gap: 6px; }
    .badge {
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      border-radius: 10px;
      padding: 1px 6px;
      font-size: 11px;
    }
    .actions { display: flex; gap: 6px; }
    .btn {
      border: 1px solid var(--vscode-button-border, transparent);
      background: var(--vscode-button-secondaryBackground, transparent);
      color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
      padding: 4px 8px;
      cursor: pointer;
      border-radius: 2px;
      font-size: 11px;
    }
    .btn.primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    .btn.primary:hover { background: var(--vscode-button-hoverBackground); }
    .btn.ghost { background: transparent; }
    .btn.small { padding: 2px 8px; font-size: 11px; }
    .btn.disabled, .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .loading {
      padding: 12px;
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--vscode-descriptionForeground);
    }
    .spinner {
      width: 12px; height: 12px;
      border: 2px solid var(--vscode-descriptionForeground);
      border-top-color: transparent;
      border-radius: 50%;
      display: inline-block;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .empty {
      padding: 16px;
      color: var(--vscode-descriptionForeground);
      text-align: center;
    }
    .empty .hint { font-size: 11px; opacity: 0.8; }
    .files { display: flex; flex-direction: column; }
    .file { border-bottom: 1px solid var(--vscode-panel-border); }
    .file-header {
      display: flex;
      align-items: baseline;
      gap: 6px;
      padding: 6px 10px;
      background: var(--vscode-sideBarSectionHeader-background);
      color: var(--vscode-sideBarSectionHeader-foreground);
      font-weight: 600;
    }
    .file-name { font-size: 12px; }
    .file-dir {
      font-size: 10px;
      opacity: 0.6;
      flex: 1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .file-count {
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      border-radius: 10px;
      padding: 0 6px;
      font-size: 10px;
    }
    .items { list-style: none; padding: 0; margin: 0; }
    .item {
      display: flex;
      gap: 8px;
      padding: 6px 10px;
      align-items: flex-start;
      border-top: 1px solid var(--vscode-panel-border);
    }
    .item:first-child { border-top: none; }
    .item:hover { background: var(--vscode-list-hoverBackground); }
    .item-main { flex: 1; cursor: pointer; min-width: 0; }
    .item-actions { flex-shrink: 0; }
    .name code {
      background: var(--vscode-textCodeBlock-background, transparent);
      padding: 0 4px;
      border-radius: 2px;
    }
    .loc { color: var(--vscode-descriptionForeground); font-size: 11px; }
    .suggestion {
      margin-top: 2px;
      color: var(--vscode-charts-green, var(--vscode-foreground));
    }
    .suggestion code {
      background: var(--vscode-textCodeBlock-background, transparent);
      padding: 0 4px;
      border-radius: 2px;
    }
    .suggestion.no-suggestion {
      color: var(--vscode-descriptionForeground);
      font-style: italic;
    }
    .message {
      margin-top: 2px;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      white-space: normal;
      word-break: break-word;
    }
  `
}

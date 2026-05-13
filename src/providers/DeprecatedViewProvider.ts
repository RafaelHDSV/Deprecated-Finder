import * as vscode from 'vscode'
import { deprecatedStore } from '../core/state/deprecatedStore'
import { DeprecatedItem } from '../core/model/DeprecatedItem'
import type { ScanProgressMessage } from '../core/scanner/scanProgressTypes'
import { handleWebviewInboundMessage } from '../webview/webviewMessageValidation'

export class DeprecatedViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'deprecatedFinder.view'

  private view?: vscode.WebviewView
  private loading = false
  /** Shown in the loading strip until the first `postProgress` message arrives. */
  private loadingProgressText: string | undefined
  private storeUnsubscribe?: () => void

  /** Save-triggered single-file scans: defer full HTML refresh so the activity strip stays visible. */
  private fileRescanDepth = 0

  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this.view = webviewView

    webviewView.webview.options = { enableScripts: true }

    this.storeUnsubscribe?.()
    this.storeUnsubscribe = deprecatedStore.onChange(() => {
      if (this.loading) {
        return
      }
      if (this.fileRescanDepth > 0) {
        return
      }
      this.refresh()
    })

    webviewView.onDidDispose(() => {
      this.storeUnsubscribe?.()
      this.storeUnsubscribe = undefined
      this.view = undefined
    })

    webviewView.webview.onDidReceiveMessage((message) => {
      handleWebviewInboundMessage(message)
    })

    this.refresh()
  }

  public refresh() {
    if (!this.view) {
      return
    }
    this.view.webview.html = this.getHtml()
  }

  public setLoading(loading: boolean, initialProgressText?: string) {
    this.loading = loading
    this.loadingProgressText = loading ? initialProgressText : undefined
    this.refresh()
  }

  /**
   * Sends a progress update to the webview without replacing the full HTML.
   * Messages use `{ type: 'progress', ...ScanProgressMessage }`.
   */
  public postProgress(update: ScanProgressMessage) {
    this.view?.webview.postMessage({ type: 'progress', ...update })
  }

  /**
   * Lightweight banner (save → single-file re-scan) without replacing the whole webview.
   */
  public beginFileRescanActivity(shortFileName: string) {
    this.fileRescanDepth++
    this.view?.webview.postMessage({
      type: 'activity',
      show: true,
      message: `Re-scanning after save: ${shortFileName}…`
    })
  }

  public endFileRescanActivity() {
    this.fileRescanDepth = Math.max(0, this.fileRescanDepth - 1)
    if (this.fileRescanDepth === 0) {
      this.view?.webview.postMessage({ type: 'activity', show: false })
      this.refresh()
    }
  }

  private getHtml(): string {
    const items = deprecatedStore.getAll()
    const fixableCount = items.filter((item) => item.suggestion).length
    const grouped = groupByFile(items)

    const fileSections = Array.from(grouped.entries())
      .map(([filePath, fileItems]) =>
        renderFileSection(filePath, fileItems, this.loading)
      )
      .join('')

    const emptyState =
      items.length === 0 && !this.loading
        ? `<div class="empty">
            <p>No deprecated symbols found yet.</p>
            <p class="hint">Save a file or click "Re-scan" to scan the workspace.</p>
          </div>`
        : ''

    const loadingState = this.loading
      ? `<div class="loading-state">
          <div class="progress-bar-wrap">
            <div class="progress-bar-inner indeterminate" id="progress-bar-inner" style="width:0%"></div>
          </div>
          <span class="spinner"></span>
          <span id="progress-text">${escHtml(this.loadingProgressText ?? 'Working…')}</span>
        </div>`
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
        <span class="badge" id="badge">${items.length}</span>
      </div>
      <div class="actions">
        <button class="btn ghost" data-action="rescan" ${this.loading ? 'disabled' : ''}>Re-scan</button>
        <button class="btn primary" id="fix-all-btn" data-action="fixAll" ${
          this.loading || fixableCount === 0 ? 'disabled' : ''
        }>Fix all (${fixableCount})</button>
      </div>
    </header>

    <div class="search-wrap">
      <input
        type="text"
        id="search"
        class="search-input"
        placeholder="Search by name or file…"
        autocomplete="off"
        spellcheck="false"
      />
    </div>

    <div id="activity-banner" class="activity-banner is-hidden" role="status" aria-live="polite">
      <span class="activity-spinner" aria-hidden="true"></span>
      <span id="activity-text" class="activity-text"></span>
    </div>

    ${loadingState}
    ${emptyState}

    <div class="files" id="files-container">${fileSections}</div>

    <div class="no-results" id="no-results" style="display:none">
      No results match your search.
    </div>

    <script>
      const vscode = acquireVsCodeApi();

      // ── Progress via postMessage ──────────────────────────────────────────
      window.addEventListener('message', (event) => {
        const msg = event.data;

        if (msg.type === 'activity') {
          const banner = document.getElementById('activity-banner');
          const label = document.getElementById('activity-text');
          if (!banner || !label) return;
          if (msg.show) {
            banner.classList.remove('is-hidden');
            label.textContent = msg.message || 'Working…';
          } else {
            banner.classList.add('is-hidden');
            label.textContent = '';
          }
          return;
        }

        if (msg.type !== 'progress') return;

        const bar = document.getElementById('progress-bar-inner');
        const text = document.getElementById('progress-text');
        if (!bar || !text) return;

        if (msg.kind === 'indeterminate') {
          bar.classList.add('indeterminate');
          bar.style.width = '';
          const n = msg.fileCount > 0 ? ' (' + msg.fileCount + ' files)' : '';
          text.textContent = msg.message + n;
          return;
        }

        bar.classList.remove('indeterminate');
        const pct = msg.total > 0 ? Math.round((msg.current / msg.total) * 100) : 0;
        bar.style.width = pct + '%';
        if (typeof msg.statusText === 'string' && msg.statusText.length > 0) {
          text.textContent = msg.statusText;
        } else if (msg.total > 0) {
          text.textContent =
            'Analyzing ' + msg.current + ' / ' + msg.total + ' workspace files…';
        } else {
          text.textContent = 'Working…';
        }
      });

      // ── Search + Fix all scope ────────────────────────────────────────────
      const searchInput = document.getElementById('search');
      const noResults = document.getElementById('no-results');
      const badgeEl = document.getElementById('badge');
      const fixAllBtn = document.getElementById('fix-all-btn');
      const scanBusy = ${this.loading ? 'true' : 'false'};

      function visibleFixableIds() {
        const ids = [];
        document.querySelectorAll('li.item').forEach((li) => {
          if (li.style.display === 'none') return;
          const btn = li.querySelector('[data-action="fixItem"][data-item-id]');
          const id = btn && btn.getAttribute('data-item-id');
          if (id) ids.push(id);
        });
        return ids;
      }

      function updateFixAllButton() {
        if (!fixAllBtn) return;
        const ids = visibleFixableIds();
        fixAllBtn.textContent = 'Fix all (' + ids.length + ')';
        fixAllBtn.disabled = scanBusy || ids.length === 0;
      }

      searchInput && searchInput.addEventListener('input', () => {
        const query = searchInput.value.toLowerCase().trim();
        let visibleCount = 0;

        document.querySelectorAll('.item').forEach(item => {
          const name = (item.querySelector('.name')?.textContent ?? '').toLowerCase();
          const file = (item.getAttribute('data-file') ?? '').toLowerCase();
          const suggest = (item.querySelector('.suggestion')?.textContent ?? '').toLowerCase();
          const visible = !query || name.includes(query) || file.includes(query) || suggest.includes(query);
          item.style.display = visible ? '' : 'none';
          if (visible) visibleCount++;
        });

        document.querySelectorAll('.file').forEach(section => {
          const hasVisible = Array.from(section.querySelectorAll('.item'))
            .some(i => i.style.display !== 'none');
          section.style.display = hasVisible ? '' : 'none';
        });

        if (noResults) {
          const hasFiles = Array.from(document.querySelectorAll('.file'))
            .some(s => s.style.display !== 'none');
          noResults.style.display = (!hasFiles && query) ? 'block' : 'none';
        }

        if (badgeEl) badgeEl.textContent = visibleCount > 0 ? String(visibleCount) : '${items.length}';
        updateFixAllButton();
      });

      updateFixAllButton();

      // ── Actions ───────────────────────────────────────────────────────────
      document.addEventListener('click', (evt) => {
        const el = evt.target && evt.target.closest('[data-action]');
        if (!el) return;
        evt.stopPropagation();

        const action = el.getAttribute('data-action');

        if (action === 'rescan') {
          vscode.postMessage({ type: 'rescan' });
        } else if (action === 'fixAll') {
          const ids = visibleFixableIds();
          if (ids.length === 0) return;
          vscode.postMessage({ type: 'fixAll', itemIds: ids });
        } else if (action === 'fixItem') {
          vscode.postMessage({ type: 'fixItem', itemId: el.getAttribute('data-item-id') });
        } else if (action === 'openFile') {
          vscode.postMessage({
            type: 'openFile',
            filePath: el.getAttribute('data-file'),
            line: Number(el.getAttribute('data-line'))
          });
        }
      });
    </script>
  </body>
</html>`
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function groupByFile(items: DeprecatedItem[]): Map<string, DeprecatedItem[]> {
  const map = new Map<string, DeprecatedItem[]>()
  for (const item of items) {
    const list = map.get(item.filePath) ?? []
    list.push(item)
    map.set(item.filePath, list)
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.line - b.line || a.column - b.column)
  }
  return map
}

function renderFileSection(
  filePath: string,
  items: DeprecatedItem[],
  actionsLocked: boolean
): string {
  const shortName = filePath.split(/[\\/]/).pop() ?? filePath
  const dir = filePath.replace(/[\\/][^\\/]*$/, '')
  const itemsHtml = items.map((item) => renderItem(item, actionsLocked)).join('')

  return `
<section class="file">
  <header class="file-header">
    <span class="file-name">${escHtml(shortName)}</span>
    <span class="file-dir" title="${escAttr(filePath)}">${escHtml(dir)}</span>
    <span class="file-count">${items.length}</span>
  </header>
  <ul class="items">${itemsHtml}</ul>
</section>`
}

function renderItem(item: DeprecatedItem, actionsLocked: boolean): string {
  const hasSuggestion = Boolean(item.suggestion)

  const suggestionHtml = hasSuggestion
    ? `<div class="suggestion">→ <code>${escHtml(item.suggestion!)}</code></div>`
    : `<div class="suggestion no-suggestion">No replacement suggested</div>`

  const fixDisabled = actionsLocked
  const fixButton = hasSuggestion
    ? `<button class="btn small primary" data-action="fixItem" data-item-id="${escAttr(
        item.id
      )}" ${fixDisabled ? 'disabled' : ''}>Fix</button>`
    : `<button class="btn small" disabled>Fix</button>`

  return `
<li class="item"
    data-item-id="${escAttr(item.id)}"
    data-file="${escAttr(item.filePath)}"
    data-line="${item.line}">
  <div class="item-main" data-action="openFile"
       data-file="${escAttr(item.filePath)}" data-line="${item.line}">
    <div class="name">
      <code>${escHtml(item.name)}</code>
      <span class="loc">:${item.line}:${item.column}</span>
    </div>
    ${suggestionHtml}
    ${item.message && item.message !== 'This API is deprecated'
      ? `<div class="message">${escHtml(item.message)}</div>`
      : ''}
  </div>
  <div class="item-actions">${fixButton}</div>
</li>`
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escAttr(s: string): string {
  return escHtml(s)
}

// ── Styles ─────────────────────────────────────────────────────────────────

function getStyles(): string {
  return `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
  font-family: var(--vscode-font-family);
  color: var(--vscode-foreground);
  background: var(--vscode-sideBar-background);
  margin: 0; padding: 0; font-size: 12px;
}
.toolbar {
  display: flex; justify-content: space-between; align-items: center;
  padding: 8px 10px;
  border-bottom: 1px solid var(--vscode-panel-border);
  position: sticky; top: 0; z-index: 10;
  background: var(--vscode-sideBar-background);
}
.title { display: flex; align-items: center; gap: 6px; }
.badge {
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
  border-radius: 10px; padding: 1px 6px; font-size: 11px; min-width: 20px;
  text-align: center;
}
.actions { display: flex; gap: 6px; }
.btn {
  border: 1px solid var(--vscode-button-border, transparent);
  background: var(--vscode-button-secondaryBackground, transparent);
  color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
  padding: 3px 8px; cursor: pointer; border-radius: 2px; font-size: 11px;
  white-space: nowrap;
}
.btn.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
.btn.primary:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
.btn.ghost { background: transparent; }
.btn.small { padding: 2px 8px; font-size: 11px; }
.btn:disabled { opacity: 0.45; cursor: not-allowed; }

/* Search */
.search-wrap {
  padding: 6px 10px;
  border-bottom: 1px solid var(--vscode-panel-border);
  position: sticky; top: 37px; z-index: 9;
  background: var(--vscode-sideBar-background);
}
.search-input {
  width: 100%;
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border, transparent);
  border-radius: 2px; padding: 4px 8px; font-size: 12px;
  outline: none;
}
.search-input:focus {
  border-color: var(--vscode-focusBorder);
}

/* Save-triggered re-scan banner */
.activity-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  background: var(--vscode-editor-inactiveSelectionBackground, rgba(127,127,127,0.12));
  border-bottom: 1px solid var(--vscode-panel-border);
}
.activity-banner.is-hidden { display: none !important; }
.activity-spinner {
  width: 11px;
  height: 11px;
  flex-shrink: 0;
  border: 2px solid var(--vscode-descriptionForeground);
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.75s linear infinite;
}
.activity-text { flex: 1; min-width: 0; word-break: break-word; }

/* Loading / progress */
.loading-state {
  padding: 12px 10px; display: flex; align-items: center; gap: 8px;
  color: var(--vscode-descriptionForeground);
  flex-wrap: wrap;
}
.progress-bar-wrap {
  width: 100%; height: 3px; background: var(--vscode-panel-border);
  border-radius: 2px; overflow: hidden; margin-bottom: 6px;
  flex: 0 0 100%;
}
.progress-bar-inner {
  height: 100%;
  background: var(--vscode-progressBar-background, var(--vscode-button-background));
  transition: width 0.2s ease;
  border-radius: 2px;
}
.progress-bar-inner.indeterminate {
  width: 40%;
  transition: none;
  animation: indeterminate-slide 1.1s ease-in-out infinite;
}
@keyframes indeterminate-slide {
  0% { transform: translateX(-30%); }
  100% { transform: translateX(250%); }
}
.spinner {
  width: 12px; height: 12px; flex-shrink: 0;
  border: 2px solid var(--vscode-descriptionForeground);
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  display: inline-block;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* Empty / no-results */
.empty, .no-results {
  padding: 20px 16px; color: var(--vscode-descriptionForeground);
  text-align: center;
}
.empty .hint { font-size: 11px; opacity: 0.75; margin-top: 4px; }
.no-results { font-style: italic; font-size: 12px; }

/* File sections */
.files { display: flex; flex-direction: column; }
.file { border-bottom: 1px solid var(--vscode-panel-border); }
.file-header {
  display: flex; align-items: baseline; gap: 6px;
  padding: 5px 10px;
  background: var(--vscode-sideBarSectionHeader-background);
  color: var(--vscode-sideBarSectionHeader-foreground);
  font-weight: 600;
}
.file-name { font-size: 12px; flex-shrink: 0; }
.file-dir {
  font-size: 10px; opacity: 0.55; flex: 1;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  direction: rtl; text-align: left;
}
.file-count {
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
  border-radius: 10px; padding: 0 5px; font-size: 10px; flex-shrink: 0;
}
.items { list-style: none; padding: 0; margin: 0; }
.item {
  display: flex; gap: 8px; padding: 5px 10px;
  align-items: flex-start;
  border-top: 1px solid var(--vscode-panel-border);
}
.item:first-child { border-top: none; }
.item:hover { background: var(--vscode-list-hoverBackground); }
.item-main { flex: 1; cursor: pointer; min-width: 0; }
.item-actions { flex-shrink: 0; padding-top: 2px; }
.name code {
  background: var(--vscode-textCodeBlock-background, transparent);
  padding: 0 3px; border-radius: 2px;
}
.loc { color: var(--vscode-descriptionForeground); font-size: 11px; }
.suggestion { margin-top: 2px; color: var(--vscode-charts-green, #4caf50); font-size: 11px; }
.suggestion code { background: var(--vscode-textCodeBlock-background, transparent); padding: 0 3px; border-radius: 2px; }
.suggestion.no-suggestion { color: var(--vscode-descriptionForeground); font-style: italic; }
.message { margin-top: 2px; color: var(--vscode-descriptionForeground); font-size: 11px; word-break: break-word; }
`
}

import { DeprecatedItem } from '../core/model/DeprecatedItem'

export function getDeprecatedPanelHtml(items: DeprecatedItem[]): string {
  const fixableCount = items.filter((item) => item.suggestion).length

  const rows = items.length === 0
    ? `<tr><td colspan="5" class="empty">No deprecated symbols found yet.</td></tr>`
    : items.map((item) => renderRow(item)).join('')

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <style>${getStyles()}</style>
  </head>
  <body>
    <header class="toolbar">
      <h2>Deprecated Finder</h2>
      <div class="actions">
        <button class="btn ghost" data-action="rescan">Re-scan workspace</button>
        <button class="btn primary" data-action="fixAll" ${
          fixableCount === 0 ? 'disabled' : ''
        }>Fix all (${fixableCount})</button>
      </div>
    </header>

    <table>
      <thead>
        <tr>
          <th>Symbol</th>
          <th>Suggestion</th>
          <th>File</th>
          <th>Location</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>

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

function renderRow(item: DeprecatedItem): string {
  const suggestion = item.suggestion
    ? `<code>${escapeHtml(item.suggestion)}</code>`
    : `<span class="muted">—</span>`

  const fixButton = item.suggestion
    ? `<button class="btn small primary" data-action="fixItem" data-item-id="${escapeAttr(
        item.id
      )}">Fix</button>`
    : `<button class="btn small" disabled>Fix</button>`

  return `
    <tr>
      <td><code>${escapeHtml(item.name)}</code></td>
      <td>${suggestion}</td>
      <td class="file" title="${escapeAttr(item.filePath)}">${escapeHtml(
    shortenPath(item.filePath)
  )}</td>
      <td>
        <a href="#"
           data-action="openFile"
           data-file="${escapeAttr(item.filePath)}"
           data-line="${item.line}">${item.line}:${item.column}</a>
      </td>
      <td>${fixButton}</td>
    </tr>
  `
}

function shortenPath(filePath: string): string {
  const parts = filePath.split(/[\\/]/)
  if (parts.length <= 3) {
    return filePath
  }
  return '…/' + parts.slice(-3).join('/')
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
    :root { color-scheme: light dark; }
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 16px;
      font-size: 13px;
    }
    .toolbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    }
    .toolbar h2 { margin: 0; }
    .actions { display: flex; gap: 8px; }
    .btn {
      border: 1px solid var(--vscode-button-border, transparent);
      background: var(--vscode-button-secondaryBackground, transparent);
      color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
      padding: 4px 10px;
      cursor: pointer;
      border-radius: 2px;
      font-size: 12px;
    }
    .btn.primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    .btn.primary:hover { background: var(--vscode-button-hoverBackground); }
    .btn.ghost { background: transparent; }
    .btn.small { padding: 2px 8px; font-size: 11px; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    table {
      width: 100%;
      border-collapse: collapse;
      background: var(--vscode-editor-background);
    }
    th, td {
      padding: 8px;
      text-align: left;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    th {
      background: var(--vscode-sideBarSectionHeader-background);
      color: var(--vscode-sideBarSectionHeader-foreground);
    }
    tr:hover td { background: var(--vscode-list-hoverBackground); }
    code {
      background: var(--vscode-textCodeBlock-background, transparent);
      padding: 0 4px;
      border-radius: 2px;
    }
    .muted { color: var(--vscode-descriptionForeground); }
    .empty { text-align: center; color: var(--vscode-descriptionForeground); padding: 24px; }
    a {
      color: var(--vscode-textLink-foreground);
      text-decoration: none;
    }
    a:hover { text-decoration: underline; }
    .file { color: var(--vscode-descriptionForeground); font-size: 12px; }
  `
}

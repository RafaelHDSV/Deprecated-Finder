"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDeprecatedPanelHtml = getDeprecatedPanelHtml;
function getDeprecatedPanelHtml(items) {
    const rows = items
        .map((item) => `
      <tr>
        <td>${item.name}</td>
        <td>${item.file}</td>
        <td>${item.line}</td>
        <td>${item.message || ''}</td>
      </tr>
    `)
        .join('');
    return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <style>
          body {
            font-family: Arial, sans-serif;
            padding: 16px;
          }
          table {
            width: 100%;
            border-collapse: collapse;
          }
          th, td {
            padding: 8px;
            border-bottom: 1px solid #ddd;
            text-align: left;
          }
          th {
            background: #1e1e1e;
            color: #fff;
          }
          tr:hover {
            background: #f3f3f3;
          }
        </style>
      </head>
      <body>
        <h2>Deprecated usages</h2>
        <table>
          <thead>
            <tr>
              <th>Symbol</th>
              <th>File</th>
              <th>Line</th>
              <th>Message</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </body>
    </html>
  `;
}

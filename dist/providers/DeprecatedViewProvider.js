"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeprecatedViewProvider = void 0;
const vscode = __importStar(require("vscode"));
const deprecatedStore_1 = require("../core/state/deprecatedStore");
class DeprecatedViewProvider {
    constructor(context) {
        this.context = context;
    }
    resolveWebviewView(webviewView) {
        this.view = webviewView;
        webviewView.webview.options = {
            enableScripts: true
        };
        // Executa o escaneamento ao abrir a aba
        Promise.resolve().then(() => __importStar(require('../core/scanner/deprecatedScanner'))).then(({ scanForDeprecated }) => {
            scanForDeprecated().then(() => {
                this.refresh();
            });
        });
        webviewView.webview.html = this.getHtml();
        webviewView.webview.onDidReceiveMessage((message) => {
            if (message.type === 'openFile') {
                this.openFile(message.filePath, message.line);
            }
        });
    }
    refresh() {
        if (!this.view)
            return;
        this.view.webview.html = this.getHtml();
    }
    getHtml() {
        const items = deprecatedStore_1.deprecatedStore.getAll();
        const listItems = items
            .map((item) => `
        <li data-file="${item.filePath}" data-line="${item.line}">
          <strong>${item.name}</strong><br/>
          <small>${item.filePath}:${item.line}</small>
          <p>${item.message ?? ''}</p>
        </li>
      `)
            .join('');
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
    `;
    }
    async openFile(filePath, line) {
        const uri = vscode.Uri.file(filePath);
        const document = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(document);
        const position = new vscode.Position(line - 1, 0);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(new vscode.Range(position, position));
    }
}
exports.DeprecatedViewProvider = DeprecatedViewProvider;
DeprecatedViewProvider.viewType = 'deprecatedFinder.view';

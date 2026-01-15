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
exports.scanForDeprecated = scanForDeprecated;
const ts = __importStar(require("typescript"));
const vscode = __importStar(require("vscode"));
const workspaceScanner_1 = require("./workspaceScanner");
const deprecatedStore_1 = require("../state/deprecatedStore");
const tsDeprecatedScanner_1 = require("./tsDeprecatedScanner");
async function scanForDeprecated() {
    const files = await (0, workspaceScanner_1.scanWorkspaceFiles)();
    if (files.length === 0) {
        vscode.window.showInformationMessage('Deprecated Finder: no TypeScript files found.');
        return;
    }
    const filePaths = files.map((f) => f.fsPath);
    const program = ts.createProgram(filePaths, {
        allowJs: true,
        target: ts.ScriptTarget.Latest,
        jsx: ts.JsxEmit.React
    });
    const deprecatedMap = new Map();
    for (const sourceFile of program.getSourceFiles()) {
        if (!sourceFile.fileName.includes('node_modules')) {
            const items = (0, tsDeprecatedScanner_1.scanFileForDeprecated)(sourceFile.fileName, program, sourceFile);
            for (const item of items) {
                const key = `${item.name}:${item.filePath}:${item.line}`;
                if (!deprecatedMap.has(key)) {
                    deprecatedMap.set(key, item);
                }
            }
        }
    }
    const deprecatedItems = Array.from(deprecatedMap.values());
    deprecatedStore_1.deprecatedStore.set(deprecatedItems);
    vscode.window.showInformationMessage(`Deprecated Finder found ${deprecatedItems.length} deprecated usages`);
    console.log('[Deprecated Finder]', deprecatedItems);
}

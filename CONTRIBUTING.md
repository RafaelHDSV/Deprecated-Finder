# Contributing to Deprecated Finder

## Setup

- Node.js 22+ (aligned with CI).
- Clone the repository, then from the repo root:

```bash
npm ci
npm run compile
npm run lint
```

See the [README](README.md) **Development** section for watch mode, the Extension Development Host (`F5`), and marketplace packaging. For scan toasts and the **Output** panel, see README **Settings** (`deprecatedFinder.showScanSummary`, `deprecatedFinder.verboseLogging`). For **full vs incremental scan** ordering (save during a long workspace scan), see README **Scan behavior (full workspace vs on-save)**.

## Webview `postMessage` contract

Sidebar (`DeprecatedViewProvider`) and tabular panel (`deprecatedPanel`) send messages to the extension host via `vscode.postMessage`. Only these shapes are accepted; anything else is **ignored** (no exception). With **`deprecatedFinder.verboseLogging`**, a line `[webview] ignored invalid or unknown message: …` is written to **Output → Deprecated Finder**.

| `type` | Required fields | Notes |
|---|---|---|
| `openFile` | `filePath` (non-empty string), `line` (integer ≥ 1) | `line` must be a **number** (not a string); 1-based line index. |
| `fixItem` | `itemId` (non-empty string) | Whitespace trimmed. |
| `fixAll` | — | Extra properties ignored. |
| `rescan` | — | Extra properties ignored. |

Implementation: `src/webview/webviewMessageValidation.ts` (`parseWebviewMessage`, `handleWebviewInboundMessage`). If you change the inline `<script>` in the webviews, keep this contract in sync.

## Path comparison policy

The extension compares file paths from different sources (VS Code `Uri.fsPath`, `TextDocument.fileName`, TypeScript `SourceFile.fileName`). Rules:

1. **Single implementation** — use `normalizePathForComparison` from `src/core/util/pathComparison.ts` for any logic that must decide whether two paths refer to the “same” file for grouping, store updates, or Quick Fix matching.
2. **Windows (`win32`)** — paths are normalized with `path.normalize`, slashes unified to `/`, then compared **case-insensitively** (`toLowerCase`) so mixed casing from APIs does not split one file into two.
3. **Linux, macOS, and other POSIX platforms** — after the same slash unification and `path.normalize`, comparison is **case-sensitive**. Two paths that differ only by letter case are treated as **different** files, matching typical case-sensitive filesystem behavior.
4. **Display** — `DeprecatedItem.filePath` and UI still show the path produced by the scanner / TypeScript; only **comparison keys** use the helper above.

Automated tests for platform-specific path behavior are not in scope yet; manual checks on Windows and a POSIX environment are welcome when touching path logic.

## Code style

Match the existing TypeScript style: no semicolons, single quotes, two-space indent. Run `npm run lint` before opening a PR.

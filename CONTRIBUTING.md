# Contributing to Deprecated Finder

## Setup

- Node.js 22+ (aligned with CI).
- Clone the repository, then from the repo root:

```bash
npm ci
npm run compile
npm run lint
```

See the [README](README.md) **Development** section for watch mode, the Extension Development Host (`F5`), and marketplace packaging. For scan toasts and the **Output** panel, see README **Settings** (`deprecatedFinder.showScanSummary`, `deprecatedFinder.verboseLogging`).

## Path comparison policy

The extension compares file paths from different sources (VS Code `Uri.fsPath`, `TextDocument.fileName`, TypeScript `SourceFile.fileName`). Rules:

1. **Single implementation** — use `normalizePathForComparison` from `src/core/util/pathComparison.ts` for any logic that must decide whether two paths refer to the “same” file for grouping, store updates, or Quick Fix matching.
2. **Windows (`win32`)** — paths are normalized with `path.normalize`, slashes unified to `/`, then compared **case-insensitively** (`toLowerCase`) so mixed casing from APIs does not split one file into two.
3. **Linux, macOS, and other POSIX platforms** — after the same slash unification and `path.normalize`, comparison is **case-sensitive**. Two paths that differ only by letter case are treated as **different** files, matching typical case-sensitive filesystem behavior.
4. **Display** — `DeprecatedItem.filePath` and UI still show the path produced by the scanner / TypeScript; only **comparison keys** use the helper above.

Automated tests for platform-specific path behavior are not in scope yet; manual checks on Windows and a POSIX environment are welcome when touching path logic.

## Code style

Match the existing TypeScript style: no semicolons, single quotes, two-space indent. Run `npm run lint` before opening a PR.

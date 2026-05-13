# Change Log

All notable changes to the **Deprecated Finder** extension are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.2] - 2026-05-13

### Changed

- README demo: animated `media/demo.gif` (from `demo.mp4`) with `<img>` + link to MP4 for GitHub and Marketplace previews.

### Added

- `npm run demo:gif` (`scripts/mp4-to-gif.cjs`, devDependency `ffmpeg-static`) to regenerate the GIF after re-recording.

## [1.0.1] - 2026-05-13

### Fixed

- Marketplace **icon**: root `icon` points to `media/icon.png` (128×128), rasterized from `media/icon.svg` via `npm run icon:rasterize` (Sharp); activity bar keeps the SVG.
- Marketplace **README video**: use `<video><source></video>` with an absolute **HTTPS** URL (`raw.githubusercontent.com`) so the preview renders in the extension page; fallback link to the MP4 on GitHub.

### Changed

- `categories` set to **Programming Languages** + **Other** (closer scope than Linters).
- `keywords` expanded (jsdoc, typescript, javascript, migration, replace, import, react) and trimmed redundant “ant design” phrase.

## [1.0.0] - 2026-05-12

### Added

- Workspace scan for `@deprecated` in `.ts`, `.tsx`, `.js`, `.jsx` using the TypeScript program API (including JSX prop deprecations resolved via component types).
- Sidebar webview listing deprecated symbols, grouped by file, with search and **Re-scan**.
- Optional tabular webview panel with the same actions.
- **Fix** per item and **Fix all** (full store or filtered by visible rows), rewriting identifiers and matching `import` statements when applicable.
- Quick Fix (`Ctrl+.`) in the editor for deprecated symbols at the cursor.
- Declaration sites listed with `atDeclarationSite` (no in-place rename on the declaration row; avoids colliding with the suggested replacement).
- After **Fix all**, optional removal of obsolete `@deprecated` exports when the editor’s reference provider reports a single self-reference and the tag suggests a simple identifier.
- Full-workspace scan queueing, progress in the UI, and optional worker-based `createProgram` per tsconfig group with heartbeat logging.
- Settings: `deprecatedFinder.showScanSummary`, `deprecatedFinder.verboseLogging`; output channel **Deprecated Finder**.

[1.0.2]: https://github.com/RafaelHDSV/Deprecated-Finder/releases
[1.0.1]: https://github.com/RafaelHDSV/Deprecated-Finder/releases
[1.0.0]: https://github.com/RafaelHDSV/Deprecated-Finder/releases

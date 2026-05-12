# Deprecated Finder

VS Code / Cursor extension that scans your workspace for `@deprecated` symbols, extracts the replacement suggested by the library author (right from the JSDoc), and lets you fix every occurrence — individually or in bulk — with a single click.

> Stop hunting for crossed-out APIs in your code. Let the IDE collect them and apply the vendor-recommended fix for you.

## What it does

- Scans `.ts`, `.tsx`, `.js`, `.jsx` files in the workspace
- Detects identifiers whose declaration is annotated with the JSDoc tag `@deprecated`
- Parses the free-form text of `@deprecated` to extract a replacement (e.g. `use destroyOnHidden instead` → `destroyOnHidden`)
- Lists every occurrence in a sidebar, grouped by file
- Offers a **Fix** button per occurrence and a **Fix all** button for the whole workspace
- Updates both the identifier and the matching `import` statement (when the replacement comes from the same file's import)
- Re-scans automatically on file save (only the saved file)
- Provides a Quick Fix on the editor lightbulb (`Ctrl+.`)

## Why

Libraries like Ant Design, MUI, and Lodash regularly mark old APIs as `@deprecated` with a clear hint about the replacement. That hint is shown in the IDE tooltip but doing the migration across hundreds of files is still manual. **Deprecated Finder** centralizes those usages and applies the suggested fix everywhere.

Example: Ant Design Modal v4 → v5
- `destroyOnClose` is marked as `@deprecated use destroyOnHidden instead`
- Deprecated Finder sees the tag, parses `destroyOnHidden`, and rewrites the prop in every file with one click.

## Usage

1. Install the extension and open a workspace.
2. The "Deprecated Finder" view appears in the activity bar.
3. The first scan runs automatically on activation; click **Re-scan** to refresh manually.
4. Click any item to jump to its location.
5. Click **Fix** on a single item, or **Fix all** to apply every available replacement.
6. Use the lightbulb (`Ctrl+.`) on a deprecated symbol to apply the fix inline.

### Available commands

| Command | Description |
|---|---|
| `Deprecated Finder: Scan workspace` | Re-scan all supported files in the workspace |
| `Deprecated Finder: Open panel` | Open the tabular panel with all results |
| `Deprecated Finder: Fix all` | Apply every available replacement |

### Suggestion patterns recognized

- `use X instead`
- `replaced by X`
- `replaced with X`
- `in favor of X`
- `utilize X`
- `prefer X`
- `{@link X}`

When no pattern matches, the item still appears in the list but the **Fix** button stays disabled.

## Development

```bash
npm install
npm run compile       # one-shot build into ./out
npm run watch         # watch mode
npm run lint          # eslint
```

For a clean clone matching CI exactly, use `npm ci` instead of `npm install`.

Open **Run and Debug** (or press `F5`) and choose **Run Extension** to open the **Extension Development Host** with this extension loaded. The workspace ships `.vscode/launch.json` and `.vscode/tasks.json`, so you do not need to recreate them after cloning.

## Compatibility

- VS Code `>= 1.100.0`
- Cursor (uses the same extension format as VS Code; install from the marketplace or from a `.vsix`)

## Roadmap

- Expand language support beyond TS/JS
- Smarter import rewrites (barrel files, re-exports)
- Optional auto-fix on save
- Configurable scan globs and ignore lists

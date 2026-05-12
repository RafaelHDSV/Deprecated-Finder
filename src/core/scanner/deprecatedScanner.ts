import * as path from 'path'
import * as ts from 'typescript'
import * as vscode from 'vscode'
import { DeprecatedItem } from '../model/DeprecatedItem'
import { deprecatedStore } from '../state/deprecatedStore'
import { scanFileForDeprecated } from './tsDeprecatedScanner'
import { scanWorkspaceFiles } from './workspaceScanner'

/** Progress updates for the sidebar UI (determinate file scan vs. long TS program build). */
export type ScanProgressMessage =
  | {
      kind: 'indeterminate'
      message: string
      /** Total root files once known; 0 while still searching */
      fileCount: number
    }
  | { kind: 'determinate'; current: number; total: number }

export type ProgressCallback = (update: ScanProgressMessage) => void

const FALLBACK_OPTIONS: ts.CompilerOptions = {
  allowJs: true,
  checkJs: false,
  target: ts.ScriptTarget.Latest,
  jsx: ts.JsxEmit.React,
  esModuleInterop: true,
  allowSyntheticDefaultImports: true,
  skipLibCheck: true,
  noEmit: true
}

/** `normalize(root tsconfig path)` → expanded parse result */
const expandedConfigByRoot = new Map<
  string,
  { parsed: ts.ParsedCommandLine; effectiveConfigPath: string }
>()

/** `normalize(source file path)` → config group key */
const configGroupKeyByFile = new Map<string, string>()

function tryParseTsConfig(
  configFilePath: string
): ts.ParsedCommandLine | undefined {
  const readResult = ts.readConfigFile(configFilePath, ts.sys.readFile)
  if (readResult.error || !readResult.config) {
    return undefined
  }
  return ts.parseJsonConfigFileContent(
    readResult.config,
    ts.sys,
    path.dirname(configFilePath)
  )
}

interface TsConfigJsonShape {
  references?: readonly { path: string }[]
}

/**
 * Vite / TS "solution" tsconfigs often have `"files": []` and only
 * `references` — parsing them yields **no** `paths`, `jsx`, or `moduleResolution`,
 * so `@/` aliases and TSX fail binding. Follow `references` or a sibling
 * `tsconfig.app.json` to obtain real compiler options.
 */
function expandToEffectiveParsedCommandLine(
  rootConfigPath: string
): { parsed: ts.ParsedCommandLine; effectiveConfigPath: string } | undefined {
  const readResult = ts.readConfigFile(rootConfigPath, ts.sys.readFile)
  if (readResult.error || !readResult.config) {
    return undefined
  }

  const baseDir = path.dirname(rootConfigPath)
  const raw = readResult.config as TsConfigJsonShape
  let parsed = ts.parseJsonConfigFileContent(readResult.config, ts.sys, baseDir)
  let effectiveConfigPath = rootConfigPath

  const hasMeaningfulOptions =
    parsed.fileNames.length > 0 ||
    Boolean(
      parsed.options.paths && Object.keys(parsed.options.paths).length > 0
    )

  if (!hasMeaningfulOptions && Array.isArray(raw.references)) {
    const refPaths = raw.references
      .map((r) => (r?.path ? path.resolve(baseDir, r.path) : ''))
      .filter((p) => p && ts.sys.fileExists(p))

    const appJson = refPaths.find(
      (p) => path.basename(p).toLowerCase() === 'tsconfig.app.json'
    )
    const orderedRefs = appJson
      ? [appJson, ...refPaths.filter((p) => p !== appJson)]
      : refPaths

    for (const refPath of orderedRefs) {
      const refParsed = tryParseTsConfig(refPath)
      const refOk =
        refParsed &&
        (refParsed.fileNames.length > 0 ||
          Boolean(
            refParsed.options.paths &&
            Object.keys(refParsed.options.paths).length > 0
          ))
      if (refOk && refParsed) {
        parsed = refParsed
        effectiveConfigPath = refPath
        break
      }
    }
  }

  const stillEmpty =
    parsed.fileNames.length === 0 &&
    !(parsed.options.paths && Object.keys(parsed.options.paths).length > 0)

  if (stillEmpty) {
    const appPath = path.join(baseDir, 'tsconfig.app.json')
    const appParsed = tryParseTsConfig(appPath)
    if (
      appParsed &&
      (appParsed.fileNames.length > 0 ||
        Boolean(
          appParsed.options.paths &&
          Object.keys(appParsed.options.paths).length > 0
        ))
    ) {
      parsed = appParsed
      effectiveConfigPath = appPath
    }
  }

  return { parsed, effectiveConfigPath }
}

function normalizePathKey(filePath: string): string {
  return filePath.replace(/\\/g, '/').toLowerCase()
}

function getExpandedForSourceFile(
  sourceFilePath: string
): { parsed: ts.ParsedCommandLine; effectiveConfigPath: string } | undefined {
  const root = ts.findConfigFile(
    path.dirname(sourceFilePath),
    ts.sys.fileExists,
    'tsconfig.json'
  )
  if (!root) {
    return undefined
  }
  const rootKey = normalizePathKey(root)
  const hit = expandedConfigByRoot.get(rootKey)
  if (hit) {
    return hit
  }
  const expanded = expandToEffectiveParsedCommandLine(root)
  if (!expanded) {
    return undefined
  }
  expandedConfigByRoot.set(rootKey, expanded)
  return expanded
}

/**
 * One program must not mix files that belong to different tsconfig projects:
 * the first matching workspace tsconfig would otherwise apply wrong
 * `paths` / `moduleResolution` (e.g. backend config on frontend files), and
 * symbol resolution misses library deprecations (antd props, icon imports).
 */
function configGroupKeyForFile(filePath: string): string {
  const fk = normalizePathKey(filePath)
  const memo = configGroupKeyByFile.get(fk)
  if (memo) {
    return memo
  }
  const expanded = getExpandedForSourceFile(filePath)
  const key = expanded
    ? normalizePathKey(expanded.effectiveConfigPath)
    : '__no_tsconfig__'
  configGroupKeyByFile.set(fk, key)
  return key
}

function groupWorkspaceFilesByTsConfig(
  filePaths: string[]
): Map<string, string[]> {
  const groups = new Map<string, string[]>()
  for (const fp of filePaths) {
    const key = configGroupKeyForFile(fp)
    const list = groups.get(key) ?? []
    list.push(fp)
    groups.set(key, list)
  }
  return groups
}

function buildScanCompilerOptions(
  parsed: ts.ParsedCommandLine
): ts.CompilerOptions {
  if (parsed.errors.length > 0) {
    console.warn(
      '[Deprecated Finder] tsconfig parse warnings:',
      parsed.errors.map((e) => e.messageText)
    )
  }
  return {
    ...parsed.options,
    allowJs: true,
    checkJs: false,
    noEmit: true,
    skipLibCheck: true,
    declaration: false,
    declarationMap: false,
    composite: false,
    incremental: false
  }
}

/**
 * Walks explicit workspace paths (not `program.getSourceFiles()`), so the
 * first progress tick happens as soon as real analysis starts — otherwise
 * thousands of `node_modules` entries can delay the counter and leave the
 * UI stuck at 0 / N during heavy `createProgram` work.
 */
function collectFromProgramWithProgress(
  program: ts.Program,
  pathsInGroup: string[],
  onProgress: ProgressCallback | undefined,
  progress: { current: number; total: number }
): DeprecatedItem[] {
  const map = new Map<string, DeprecatedItem>()

  for (const fp of pathsInGroup) {
    const sourceFile = getSourceFileForPath(program, fp)
    if (!sourceFile || sourceFile.fileName.includes('node_modules')) {
      progress.current++
      onProgress?.({
        kind: 'determinate',
        current: Math.min(progress.current, progress.total),
        total: progress.total
      })
      continue
    }

    const fileName = sourceFile.fileName
    const items = scanFileForDeprecated(fileName, program, sourceFile)
    for (const item of items) {
      map.set(item.id, item)
    }

    progress.current++
    onProgress?.({
      kind: 'determinate',
      current: Math.min(progress.current, progress.total),
      total: progress.total
    })
  }

  return Array.from(map.values())
}

export async function scanForDeprecated(
  onProgress?: ProgressCallback
): Promise<DeprecatedItem[]> {
  onProgress?.({
    kind: 'indeterminate',
    message: 'Searching workspace for source files…',
    fileCount: 0
  })

  const files = await scanWorkspaceFiles()

  if (files.length === 0) {
    deprecatedStore.set([])
    vscode.window.showInformationMessage(
      'Deprecated Finder: no source files found in the workspace.'
    )
    return []
  }

  const filePaths = files.map((f) => f.fsPath)

  onProgress?.({
    kind: 'indeterminate',
    message: `Preparing scan (${filePaths.length} source files)…`,
    fileCount: 0
  })

  const groups = groupWorkspaceFilesByTsConfig(filePaths)
  const progress = { current: 0, total: filePaths.length }
  const map = new Map<string, DeprecatedItem>()

  let groupIndex = 0
  const groupCount = groups.size

  for (const [groupKey, paths] of groups) {
    groupIndex++
    onProgress?.({
      kind: 'indeterminate',
      message:
        groupCount > 1
          ? `Building TypeScript program (${groupIndex}/${groupCount})…`
          : 'Building TypeScript program…',
      fileCount: 0
    })

    const expanded =
      groupKey === '__no_tsconfig__'
        ? undefined
        : getExpandedForSourceFile(paths[0] ?? '')
    const options = expanded
      ? buildScanCompilerOptions(expanded.parsed)
      : FALLBACK_OPTIONS
    const effectiveLabel = expanded?.effectiveConfigPath ?? '(fallback options)'

    console.log(
      `[Deprecated Finder] Program for group "${groupKey}": ${paths.length} file(s); tsconfig: ${effectiveLabel}`
    )

    const program = ts.createProgram(paths, options)
    const chunk = collectFromProgramWithProgress(
      program,
      paths,
      onProgress,
      progress
    )
    for (const item of chunk) {
      map.set(item.id, item)
    }
  }

  const items = Array.from(map.values())

  deprecatedStore.set(items)

  vscode.window.showInformationMessage(
    `Deprecated Finder: found ${items.length} deprecated usage${items.length === 1 ? '' : 's'}.`
  )

  console.log(`[Deprecated Finder] Workspace scan: ${items.length} item(s)`)
  return items
}

export async function scanSingleFile(
  filePath: string
): Promise<DeprecatedItem[]> {
  if (!isSupportedFile(filePath)) {
    return []
  }

  const files = await scanWorkspaceFiles()
  if (files.length === 0) {
    return []
  }

  const allPaths = files.map((f) => f.fsPath)
  const groupKey = configGroupKeyForFile(filePath)
  const groupPaths = allPaths.filter(
    (p) => configGroupKeyForFile(p) === groupKey
  )

  const expanded =
    groupKey === '__no_tsconfig__'
      ? undefined
      : getExpandedForSourceFile(filePath)
  const options = expanded
    ? buildScanCompilerOptions(expanded.parsed)
    : FALLBACK_OPTIONS

  const freshProgram = ts.createProgram(groupPaths, options)

  const sourceFile = getSourceFileForPath(freshProgram, filePath)
  if (!sourceFile) {
    console.warn(`[Deprecated Finder] Could not load source file: ${filePath}`)
    return []
  }

  const items = scanFileForDeprecated(filePath, freshProgram, sourceFile)
  deprecatedStore.updateFile(sourceFile.fileName, items)
  console.log(
    `[Deprecated Finder] File scan (${sourceFile.fileName}): ${items.length} item(s)`
  )
  return items
}

function getSourceFileForPath(
  program: ts.Program,
  filePath: string
): ts.SourceFile | undefined {
  const direct =
    program.getSourceFile(filePath) ??
    program.getSourceFile(path.normalize(filePath))

  if (direct) {
    return direct
  }

  const target = normalizePathKey(filePath)
  return program
    .getSourceFiles()
    .find((sf) => normalizePathKey(sf.fileName) === target)
}

export function invalidateProgramCache() {
  expandedConfigByRoot.clear()
  configGroupKeyByFile.clear()
}

function isSupportedFile(filePath: string): boolean {
  return /\.(ts|tsx|js|jsx)$/i.test(filePath)
}

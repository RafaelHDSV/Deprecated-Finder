import * as path from 'path'
import * as ts from 'typescript'
import * as vscode from 'vscode'
import { DeprecatedItem } from '../model/DeprecatedItem'
import { deprecatedStore } from '../state/deprecatedStore'
import { normalizePathForComparison } from '../util/pathComparison'
import {
  getShowScanSummary,
  logScanDiagnostic,
  logScanWarning,
  shouldToastScanResultSummary
} from '../../logging/deprecatedFinderLog'
import { scanFileForDeprecated } from './tsDeprecatedScanner'
import { scanWorkspaceFiles } from './workspaceScanner'

/**
 * Monotonic serial: only the latest `scanForDeprecated` request may call
 * `deprecatedStore.set`, show the summary toast, and drive `onProgress`.
 * Full workspace scans are serialized (see `fullWorkspaceScanTurn`) so this
 * mainly guards hypothetical future overlap; it also matches superseded logs.
 */
let scanRequestSerial = 0

/** One full workspace scan at a time — avoids progress/UI stuck mid-run when a second scan bumps the serial while the first is still in sync `createProgram` work. */
let fullWorkspaceScanTurn: Promise<void> = Promise.resolve()

/**
 * Full workspace scan (`scanForDeprecated`) vs incremental (`scanSingleFile`):
 * while a full scan runs, incremental updates must not call `deprecatedStore.updateFile`,
 * or the sidebar would briefly show a mix of one fresh file and stale entries for others.
 * See README "Scan behavior" and `context.md` (fluxo de varredura).
 */
let fullWorkspaceScanDepth = 0

/** Normalized path key → latest absolute path for `scanSingleFile` after the outermost full scan. */
const pendingSingleFileRescans = new Map<string, string>()

/** When true, `scanSingleFile` applies results; when false and a full scan is active, it only enqueues. */
let flushDeferredSingleFileScans = false

function queueSingleFileRescan(filePath: string) {
  pendingSingleFileRescans.set(
    normalizePathForComparison(filePath),
    filePath
  )
}

async function flushPendingSingleFileRescans() {
  if (pendingSingleFileRescans.size === 0) {
    return
  }
  flushDeferredSingleFileScans = true
  const paths = [...pendingSingleFileRescans.values()]
  pendingSingleFileRescans.clear()
  try {
    for (const p of paths) {
      await scanSingleFile(p)
    }
  } finally {
    flushDeferredSingleFileScans = false
  }
}

async function leaveFullWorkspaceScan() {
  fullWorkspaceScanDepth--
  if (fullWorkspaceScanDepth === 0) {
    await flushPendingSingleFileRescans()
  }
}

/** Progress updates for the sidebar UI (determinate file scan vs. long TS program build). */
export type ScanProgressMessage =
  | {
      kind: 'indeterminate'
      message: string
      /** Total root files once known; 0 while still searching */
      fileCount: number
    }
  | {
      kind: 'determinate'
      current: number
      total: number
      /** Full status line; when set, the webview uses this instead of the default "Analyzing …" text. */
      statusText?: string
    }

export type ProgressCallback = (update: ScanProgressMessage) => void

/** Wording for the full-workspace scan phase (e.g. after Fix all). */
export type ScanNarrative = 'default' | 'post-fix'

export interface ScanForDeprecatedOptions {
  narrative?: ScanNarrative
}

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
  const rootKey = normalizePathForComparison(root)
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
  const fk = normalizePathForComparison(filePath)
  const memo = configGroupKeyByFile.get(fk)
  if (memo) {
    return memo
  }
  const expanded = getExpandedForSourceFile(filePath)
  const key = expanded
    ? normalizePathForComparison(expanded.effectiveConfigPath)
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
    logScanWarning(
      `tsconfig parse warnings: ${parsed.errors
        .map((e) => String(e.messageText))
        .join('; ')}`
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
  progress: { current: number; total: number },
  narrative: ScanNarrative
): DeprecatedItem[] {
  const map = new Map<string, DeprecatedItem>()
  const determinatePrefix = narrative === 'post-fix' ? 'Re-scanning workspace' : undefined

  for (const fp of pathsInGroup) {
    const sourceFile = getSourceFileForPath(program, fp)
    if (!sourceFile || sourceFile.fileName.includes('node_modules')) {
      progress.current++
      onProgress?.({
        kind: 'determinate',
        current: Math.min(progress.current, progress.total),
        total: progress.total,
        statusText:
          determinatePrefix !== undefined
            ? `${determinatePrefix}: ${Math.min(progress.current, progress.total)} / ${progress.total} files…`
            : undefined
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
      total: progress.total,
      statusText:
        determinatePrefix !== undefined
          ? `${determinatePrefix}: ${Math.min(progress.current, progress.total)} / ${progress.total} files…`
          : undefined
    })
  }

  return Array.from(map.values())
}

/**
 * Full workspace scan: builds programs per tsconfig group, then replaces the in-memory
 * list with `deprecatedStore.set`. Re-entrant safe (`fullWorkspaceScanDepth`).
 * Single-file rescans requested during this call are queued and run after the outermost
 * invocation completes (see `scanSingleFile`).
 * Concurrent overlapping scans use `scanRequestSerial` so only the latest request
 * applies progress, `set`, and the summary toast; older runs discard those effects.
 * Calls are queued on `fullWorkspaceScanTurn` so two full scans never run in parallel.
 */
export async function scanForDeprecated(
  onProgress?: ProgressCallback,
  options?: ScanForDeprecatedOptions
): Promise<DeprecatedItem[]> {
  const previousTurn = fullWorkspaceScanTurn
  let endTurn!: () => void
  fullWorkspaceScanTurn = new Promise<void>((resolve) => {
    endTurn = resolve
  })
  await previousTurn
  try {
    return await runFullWorkspaceScan(onProgress, options)
  } finally {
    endTurn()
  }
}

async function runFullWorkspaceScan(
  onProgress?: ProgressCallback,
  options?: ScanForDeprecatedOptions
): Promise<DeprecatedItem[]> {
  fullWorkspaceScanDepth++
  try {
  const mySerial = ++scanRequestSerial
  const reportProgress: ProgressCallback = (update) => {
    if (mySerial !== scanRequestSerial) {
      return
    }
    onProgress?.(update)
  }

  const narrative: ScanNarrative = options?.narrative ?? 'default'
  const postFix = narrative === 'post-fix'
  const summaryMode = getShowScanSummary()

  reportProgress({
    kind: 'indeterminate',
    message: postFix
      ? 'Re-scanning workspace: locating source files…'
      : 'Searching workspace for source files…',
    fileCount: 0
  })

  const files = await scanWorkspaceFiles()

  if (files.length === 0) {
    if (mySerial !== scanRequestSerial) {
      return []
    }
    deprecatedStore.set([])
    vscode.window.showInformationMessage(
      'Deprecated Finder: no source files found in the workspace.'
    )
    return []
  }

  const filePaths = files.map((f) => f.fsPath)

  reportProgress({
    kind: 'indeterminate',
    message: postFix
      ? `Re-scanning workspace: preparing (${filePaths.length} source files)…`
      : `Preparing scan (${filePaths.length} source files)…`,
    fileCount: 0
  })

  const groups = groupWorkspaceFilesByTsConfig(filePaths)
  const progress = { current: 0, total: filePaths.length }
  const map = new Map<string, DeprecatedItem>()

  let groupIndex = 0
  const groupCount = groups.size

  for (const [groupKey, paths] of groups) {
    groupIndex++
    reportProgress({
      kind: 'indeterminate',
      message: postFix
        ? groupCount > 1
          ? `Re-scanning workspace: building programs (${groupIndex}/${groupCount})…`
          : 'Re-scanning workspace: building program…'
        : groupCount > 1
          ? `Building program (${groupIndex}/${groupCount})…`
          : 'Building program…',
      fileCount: 0
    })

    const expanded =
      groupKey === '__no_tsconfig__'
        ? undefined
        : getExpandedForSourceFile(paths[0] ?? '')
    const compilerOptions = expanded
      ? buildScanCompilerOptions(expanded.parsed)
      : FALLBACK_OPTIONS
    const effectiveLabel = expanded?.effectiveConfigPath ?? '(fallback options)'

    if (mySerial === scanRequestSerial) {
      logScanDiagnostic(
        `[Deprecated Finder] Program for group "${groupKey}": ${paths.length} file(s); tsconfig: ${effectiveLabel}`
      )
    }

    const program = ts.createProgram(paths, compilerOptions)
    const chunk = collectFromProgramWithProgress(
      program,
      paths,
      reportProgress,
      progress,
      narrative
    )
    for (const item of chunk) {
      map.set(item.id, item)
    }
  }

  const items = Array.from(map.values())

  if (mySerial !== scanRequestSerial) {
    logScanDiagnostic(
      `[Deprecated Finder] Superseded workspace scan discarded (${items.length} item(s) not applied)`
    )
    return items
  }

  deprecatedStore.set(items)

  if (shouldToastScanResultSummary(summaryMode, items.length)) {
    vscode.window.showInformationMessage(
      `Deprecated Finder: found ${items.length} deprecated usage${items.length === 1 ? '' : 's'}.`
    )
  }

  logScanDiagnostic(
    `[Deprecated Finder] Workspace scan: ${items.length} item(s)`
  )
  return items
  } finally {
    await leaveFullWorkspaceScan()
  }
}


/**
 * Incremental scan of one file for the sidebar / Quick Fix store.
 * During an active `scanForDeprecated`, updates are deferred (queued) until the full
 * scan finishes, so the UI never shows a hybrid of one fresh file and stale others.
 */
export async function scanSingleFile(
  filePath: string
): Promise<DeprecatedItem[]> {
  if (!isSupportedFile(filePath)) {
    return []
  }

  if (!flushDeferredSingleFileScans && fullWorkspaceScanDepth > 0) {
    queueSingleFileRescan(filePath)
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
    logScanWarning(`Could not load source file: ${filePath}`)
    return []
  }

  const items = scanFileForDeprecated(filePath, freshProgram, sourceFile)
  deprecatedStore.updateFile(sourceFile.fileName, items)
  logScanDiagnostic(
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

  const target = normalizePathForComparison(filePath)
  return program
    .getSourceFiles()
    .find((sf) => normalizePathForComparison(sf.fileName) === target)
}

export function invalidateProgramCache() {
  expandedConfigByRoot.clear()
  configGroupKeyByFile.clear()
}

function isSupportedFile(filePath: string): boolean {
  return /\.(ts|tsx|js|jsx)$/i.test(filePath)
}

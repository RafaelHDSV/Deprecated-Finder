import * as ts from 'typescript'
import * as path from 'path'
import * as vscode from 'vscode'
import { scanWorkspaceFiles } from './workspaceScanner'
import { deprecatedStore } from '../state/deprecatedStore'
import { scanFileForDeprecated } from './tsDeprecatedScanner'
import { DeprecatedItem } from '../model/DeprecatedItem'

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

let cachedProgram: ts.Program | undefined
let cachedFingerprint = ''
let cachedOptions: ts.CompilerOptions | undefined

function pathKey(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase()
}

/** Avoid picking this extension's own tsconfig when the workspace is multi-root. */
function isDeprecatedFinderTsConfig(configPath: string): boolean {
  return pathKey(configPath).includes('/deprecated-finder/')
}

function collectWorkspaceTsConfigPaths(): string[] {
  const folders = vscode.workspace.workspaceFolders ?? []
  const seen = new Set<string>()
  const out: string[] = []
  for (const folder of folders) {
    const found = ts.findConfigFile(folder.uri.fsPath, ts.sys.fileExists, 'tsconfig.json')
    if (found && !seen.has(pathKey(found))) {
      seen.add(pathKey(found))
      out.push(found)
    }
  }
  return out
}

function tryParseTsConfig(configFilePath: string): ts.ParsedCommandLine | undefined {
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

type TsConfigJsonShape = {
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
    Boolean(parsed.options.paths && Object.keys(parsed.options.paths).length > 0)

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
          Boolean(refParsed.options.paths && Object.keys(refParsed.options.paths).length > 0))
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
        Boolean(appParsed.options.paths && Object.keys(appParsed.options.paths).length > 0))
    ) {
      parsed = appParsed
      effectiveConfigPath = appPath
    }
  }

  return { parsed, effectiveConfigPath }
}

/**
 * Reads tsconfig(s) from the workspace and extracts compiler options. Prefers
 * a real application tsconfig (not this repo's extension config) when the
 * window is multi-root. Expands solution-style configs so path aliases and
 * JSX match the app (e.g. Vite `tsconfig.json` → `tsconfig.app.json`).
 */
function resolveCompilerOptions(): ts.CompilerOptions {
  if (cachedOptions) {
    return cachedOptions
  }

  const candidates = collectWorkspaceTsConfigPaths()
  const preferred = candidates.filter((c) => !isDeprecatedFinderTsConfig(c))
  const ordered = preferred.length > 0 ? preferred : candidates

  for (const configPath of ordered) {
    const expanded = expandToEffectiveParsedCommandLine(configPath)
    if (!expanded) {
      continue
    }

    const { parsed, effectiveConfigPath } = expanded

    if (parsed.errors.length > 0) {
      console.warn(
        '[Deprecated Finder] tsconfig parse warnings:',
        parsed.errors.map((e) => e.messageText)
      )
    }

    console.log(`[Deprecated Finder] Using tsconfig: ${effectiveConfigPath}`)

    cachedOptions = {
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

    return cachedOptions
  }

  console.log('[Deprecated Finder] No tsconfig.json found, using fallback options')
  cachedOptions = FALLBACK_OPTIONS
  return FALLBACK_OPTIONS
}

export async function scanForDeprecated(onProgress?: ProgressCallback): Promise<DeprecatedItem[]> {
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
    message: 'Building TypeScript program (parsing & binding)…',
    fileCount: filePaths.length
  })

  const program = createProgram(filePaths)

  onProgress?.({ kind: 'determinate', current: 0, total: filePaths.length })

  const items = collectFromProgramWithProgress(program, filePaths, onProgress)

  deprecatedStore.set(items)

  vscode.window.showInformationMessage(
    `Deprecated Finder: found ${items.length} deprecated usage${items.length === 1 ? '' : 's'}.`
  )

  console.log(`[Deprecated Finder] Workspace scan: ${items.length} item(s)`)
  return items
}

export async function scanSingleFile(filePath: string): Promise<DeprecatedItem[]> {
  if (!isSupportedFile(filePath)) {
    return []
  }

  let program = cachedProgram
  if (!program) {
    const files = await scanWorkspaceFiles()
    if (files.length === 0) {
      return []
    }
    program = createProgram(files.map((f) => f.fsPath))
  }

  // The cached program has a snapshot of the file at the time it was created.
  // For a save-triggered re-scan, we create a fresh program with the same
  // root files so the saved content is picked up.
  const freshProgram = ts.createProgram(
    program.getRootFileNames() as string[],
    resolveCompilerOptions(),
    undefined,
    program
  )

  const sourceFile = getSourceFileForPath(freshProgram, filePath)
  if (!sourceFile) {
    console.warn(`[Deprecated Finder] Could not load source file: ${filePath}`)
    return []
  }

  const items = scanFileForDeprecated(filePath, freshProgram, sourceFile)
  deprecatedStore.updateFile(sourceFile.fileName, items)
  console.log(`[Deprecated Finder] File scan (${sourceFile.fileName}): ${items.length} item(s)`)
  return items
}

function collectFromProgramWithProgress(
  program: ts.Program,
  filePaths: string[],
  onProgress?: ProgressCallback
): DeprecatedItem[] {
  const filePathSet = new Set(filePaths.map((p) => normalize(p)))
  const map = new Map<string, DeprecatedItem>()
  let processed = 0

  for (const sourceFile of program.getSourceFiles()) {
    const fileName = sourceFile.fileName
    if (fileName.includes('node_modules')) {
      continue
    }
    if (!filePathSet.has(normalize(fileName))) {
      continue
    }

    const items = scanFileForDeprecated(fileName, program, sourceFile)
    for (const item of items) {
      map.set(item.id, item)
    }

    processed++
    onProgress?.({ kind: 'determinate', current: processed, total: filePaths.length })
  }

  return Array.from(map.values())
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

  const target = normalize(filePath)
  return program.getSourceFiles().find((sf) => normalize(sf.fileName) === target)
}

function createProgram(filePaths: string[]): ts.Program {
  const fingerprint = filePaths.slice().sort().join('|')
  if (cachedProgram && fingerprint === cachedFingerprint) {
    return cachedProgram
  }

  const options = resolveCompilerOptions()
  cachedProgram = ts.createProgram(filePaths, options)
  cachedFingerprint = fingerprint
  return cachedProgram
}

export function invalidateProgramCache() {
  cachedProgram = undefined
  cachedFingerprint = ''
  cachedOptions = undefined
}

function isSupportedFile(filePath: string): boolean {
  return /\.(ts|tsx|js|jsx)$/i.test(filePath)
}

function normalize(filePath: string): string {
  return filePath.replace(/\\/g, '/').toLowerCase()
}

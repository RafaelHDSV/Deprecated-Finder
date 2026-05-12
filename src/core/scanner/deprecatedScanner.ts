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

/**
 * Reads the nearest tsconfig.json from the workspace root and extracts its
 * compiler options. Falls back to safe defaults when no config is found.
 *
 * Using the project's own tsconfig is critical so that module resolution,
 * JSX settings, path aliases and lib declarations match exactly what the
 * project expects — otherwise symbol lookup for JSX props (e.g. antd's
 * `destroyOnClose`) fails silently, and call-expression resolution may pick
 * up incorrect overloads.
 */
function resolveCompilerOptions(): ts.CompilerOptions {
  if (cachedOptions) {
    return cachedOptions
  }

  const rootDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  if (!rootDir) {
    cachedOptions = FALLBACK_OPTIONS
    return FALLBACK_OPTIONS
  }

  const configPath = ts.findConfigFile(rootDir, ts.sys.fileExists, 'tsconfig.json')
  if (!configPath) {
    console.log('[Deprecated Finder] No tsconfig.json found, using fallback options')
    cachedOptions = FALLBACK_OPTIONS
    return FALLBACK_OPTIONS
  }

  const readResult = ts.readConfigFile(configPath, ts.sys.readFile)
  if (readResult.error || !readResult.config) {
    console.warn('[Deprecated Finder] Could not read tsconfig.json:', readResult.error?.messageText)
    cachedOptions = FALLBACK_OPTIONS
    return FALLBACK_OPTIONS
  }

  const parsed = ts.parseJsonConfigFileContent(
    readResult.config,
    ts.sys,
    path.dirname(configPath)
  )

  if (parsed.errors.length > 0) {
    console.warn('[Deprecated Finder] tsconfig.json parse warnings:', parsed.errors.map((e) => e.messageText))
  }

  console.log(`[Deprecated Finder] Using tsconfig: ${configPath}`)

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

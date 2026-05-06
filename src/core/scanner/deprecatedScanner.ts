import * as ts from 'typescript'
import * as vscode from 'vscode'
import { scanWorkspaceFiles } from './workspaceScanner'
import { deprecatedStore } from '../state/deprecatedStore'
import { scanFileForDeprecated } from './tsDeprecatedScanner'
import { DeprecatedItem } from '../model/DeprecatedItem'

const COMPILER_OPTIONS: ts.CompilerOptions = {
  allowJs: true,
  checkJs: false,
  target: ts.ScriptTarget.Latest,
  jsx: ts.JsxEmit.ReactJSX,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  esModuleInterop: true,
  skipLibCheck: true,
  noEmit: true
}

let cachedProgram: ts.Program | undefined
let cachedFingerprint = ''

export async function scanForDeprecated(): Promise<DeprecatedItem[]> {
  const files = await scanWorkspaceFiles()

  if (files.length === 0) {
    deprecatedStore.set([])
    vscode.window.showInformationMessage(
      'Deprecated Finder: no source files found in the workspace.'
    )
    return []
  }

  const filePaths = files.map((f) => f.fsPath)
  const program = createProgram(filePaths)
  const items = collectFromProgram(program, filePaths)

  deprecatedStore.set(items)

  vscode.window.showInformationMessage(
    `Deprecated Finder: found ${items.length} deprecated usage${
      items.length === 1 ? '' : 's'
    }.`
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

  const sourceFile = program.getSourceFile(filePath)

  if (!sourceFile) {
    const refreshed = createProgram([filePath, ...program.getRootFileNames()])
    const refreshedSource = refreshed.getSourceFile(filePath)
    if (!refreshedSource) {
      return []
    }
    const items = scanFileForDeprecated(filePath, refreshed, refreshedSource)
    deprecatedStore.updateFile(filePath, items)
    console.log(
      `[Deprecated Finder] File scan (${filePath}): ${items.length} item(s)`
    )
    return items
  }

  const items = scanFileForDeprecated(filePath, program, sourceFile)
  deprecatedStore.updateFile(filePath, items)
  console.log(
    `[Deprecated Finder] File scan (${filePath}): ${items.length} item(s)`
  )
  return items
}

function collectFromProgram(
  program: ts.Program,
  filePaths: string[]
): DeprecatedItem[] {
  const filePathSet = new Set(filePaths.map((p) => normalize(p)))
  const map = new Map<string, DeprecatedItem>()

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
  }

  return Array.from(map.values())
}

function createProgram(filePaths: string[]): ts.Program {
  const fingerprint = filePaths.slice().sort().join('|')
  if (cachedProgram && fingerprint === cachedFingerprint) {
    return cachedProgram
  }

  cachedProgram = ts.createProgram(filePaths, COMPILER_OPTIONS)
  cachedFingerprint = fingerprint
  return cachedProgram
}

export function invalidateProgramCache() {
  cachedProgram = undefined
  cachedFingerprint = ''
}

function isSupportedFile(filePath: string): boolean {
  return /\.(ts|tsx|js|jsx)$/i.test(filePath)
}

function normalize(filePath: string): string {
  return filePath.replace(/\\/g, '/').toLowerCase()
}

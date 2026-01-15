import * as ts from 'typescript'
import * as vscode from 'vscode'
import { scanWorkspaceFiles } from './workspaceScanner'
import { deprecatedStore } from '../state/deprecatedStore'
import { scanFileForDeprecated } from './tsDeprecatedScanner'

export async function scanForDeprecated() {
  const files = await scanWorkspaceFiles()

  if (files.length === 0) {
    vscode.window.showInformationMessage(
      'Deprecated Finder: no TypeScript files found.'
    )
    return
  }

  const filePaths = files.map((f) => f.fsPath)

  const program = ts.createProgram(filePaths, {
    allowJs: true,
    target: ts.ScriptTarget.Latest,
    jsx: ts.JsxEmit.React
  })

  const deprecatedItems = []

  for (const sourceFile of program.getSourceFiles()) {
    if (!sourceFile.fileName.includes('node_modules')) {
      const items = scanFileForDeprecated(
        sourceFile.fileName,
        program,
        sourceFile
      )
      deprecatedItems.push(...items)
    }
  }

  deprecatedStore.set(deprecatedItems)

  // vscode.window.showInformationMessage(
  //   `Deprecated Finder found ${deprecatedItems.length} deprecated usages`
  // )

  console.log('[Deprecated Finder]', deprecatedItems)
}

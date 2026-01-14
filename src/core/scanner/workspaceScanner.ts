import * as vscode from 'vscode'

export async function scanWorkspaceFiles(): Promise<vscode.Uri[]> {
  if (!vscode.workspace.workspaceFolders) {
    return []
  }

  const files = await vscode.workspace.findFiles(
    '**/*.{ts,tsx}',
    '**/{node_modules,dist,build,out}/**'
  )

  return files
}

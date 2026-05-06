import * as vscode from 'vscode'

export async function scanWorkspaceFiles(): Promise<vscode.Uri[]> {
  if (!vscode.workspace.workspaceFolders) {
    return []
  }

  const files = await vscode.workspace.findFiles(
    '**/*.{ts,tsx,js,jsx}',
    '**/{node_modules,dist,build,out,.next,.git}/**'
  )

  return files
}

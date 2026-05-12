import * as vscode from 'vscode'

let channel: vscode.OutputChannel | undefined

export function registerDeprecatedFinderLog(
  context: vscode.ExtensionContext
): vscode.OutputChannel {
  const ch = vscode.window.createOutputChannel('Deprecated Finder')
  channel = ch
  context.subscriptions.push(ch)
  return ch
}

function isVerboseLogging(): boolean {
  return Boolean(
    vscode.workspace.getConfiguration('deprecatedFinder').get('verboseLogging')
  )
}

/** Per-group program / file-scan diagnostics; only when verboseLogging is on. */
export function logScanDiagnostic(message: string): void {
  if (!isVerboseLogging() || !channel) {
    return
  }
  channel.appendLine(message)
}

/** Warnings (e.g. tsconfig parse, missing source file) — always on the channel when registered. */
export function logScanWarning(message: string): void {
  channel?.appendLine(`[WARN] ${message}`)
}

/** Errors (initial scan, save re-scan) — always on the channel when registered. */
export function logScanError(message: string, detail?: unknown): void {
  if (!channel) {
    return
  }
  channel.appendLine(`[ERROR] ${message}`)
  if (detail !== undefined) {
    if (detail instanceof Error) {
      channel.appendLine(detail.stack ?? detail.message)
    } else {
      channel.appendLine(String(detail))
    }
  }
}

export type ShowScanSummary = 'always' | 'whenIssuesFound' | 'never'

export function getShowScanSummary(): ShowScanSummary {
  const raw = vscode.workspace
    .getConfiguration('deprecatedFinder')
    .get<string>('showScanSummary', 'whenIssuesFound')
  if (raw === 'always' || raw === 'never') {
    return raw
  }
  return 'whenIssuesFound'
}

export function shouldToastScanResultSummary(
  mode: ShowScanSummary,
  deprecatedCount: number
): boolean {
  if (mode === 'never') {
    return false
  }
  if (mode === 'always') {
    return true
  }
  return deprecatedCount > 0
}

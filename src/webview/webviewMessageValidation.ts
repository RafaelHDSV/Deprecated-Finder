import * as vscode from 'vscode'
import { logScanDiagnostic } from '../logging/deprecatedFinderLog'

/** Maximum item IDs accepted on `fixAll` from webviews (abuse guard). */
export const MAX_FIX_ALL_ITEM_IDS = 100_000

export type WebviewInboundMessage =
  | { type: 'openFile'; filePath: string; line: number }
  | { type: 'fixItem'; itemId: string }
  | { type: 'fixAll'; itemIds?: string[] }
  | { type: 'rescan' }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isValidLine(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 1
  )
}

/**
 * Parses `postMessage` payloads from our webviews (sidebar + tabular panel).
 * Returns `undefined` for unknown types or malformed payloads — never throws.
 */
export function parseWebviewMessage(raw: unknown): WebviewInboundMessage | undefined {
  if (!isRecord(raw)) {
    return undefined
  }

  const t = raw.type
  if (typeof t !== 'string') {
    return undefined
  }

  switch (t) {
    case 'openFile': {
      if (!isNonEmptyString(raw.filePath) || !isValidLine(raw.line)) {
        return undefined
      }
      return { type: 'openFile', filePath: raw.filePath.trim(), line: raw.line }
    }
    case 'fixItem': {
      if (!isNonEmptyString(raw.itemId)) {
        return undefined
      }
      return { type: 'fixItem', itemId: raw.itemId.trim() }
    }
    case 'fixAll': {
      const rawIds = raw.itemIds
      if (rawIds === undefined || rawIds === null) {
        return { type: 'fixAll' }
      }
      if (!Array.isArray(rawIds) || rawIds.length > MAX_FIX_ALL_ITEM_IDS) {
        return undefined
      }
      const itemIds: string[] = []
      for (const el of rawIds) {
        if (typeof el !== 'string' || el.trim().length === 0) {
          return undefined
        }
        itemIds.push(el.trim())
      }
      return { type: 'fixAll', itemIds }
    }
    case 'rescan':
      return { type: 'rescan' }
    default:
      return undefined
  }
}

function summarizeRawForLog(raw: unknown): string {
  if (raw === null) {
    return 'null'
  }
  if (typeof raw !== 'object') {
    return String(raw)
  }
  try {
    const s = JSON.stringify(raw)
    return s.length > 500 ? `${s.slice(0, 500)}…` : s
  } catch {
    return '[object]'
  }
}

/** When `deprecatedFinder.verboseLogging` is on, logs ignored webview payloads. */
function logIgnoredWebviewMessage(raw: unknown): void {
  logScanDiagnostic(
    `[webview] ignored invalid or unknown message: ${summarizeRawForLog(raw)}`
  )
}

export function dispatchWebviewInboundMessage(msg: WebviewInboundMessage): void {
  switch (msg.type) {
    case 'openFile':
      void vscode.commands.executeCommand(
        'deprecatedFinder.openFile',
        msg.filePath,
        msg.line
      )
      return
    case 'fixItem':
      void vscode.commands.executeCommand(
        'deprecatedFinder.fixItem',
        msg.itemId
      )
      return
    case 'fixAll':
      if (msg.itemIds && msg.itemIds.length > 0) {
        void vscode.commands.executeCommand(
          'deprecatedFinder.fixAll',
          msg.itemIds
        )
      } else {
        void vscode.commands.executeCommand('deprecatedFinder.fixAll')
      }
      return
    case 'rescan':
      void vscode.commands.executeCommand('deprecatedFinder.scan')
      return
  }
}

/** Parse, optionally log invalid payloads (verbose only), then dispatch commands. */
export function handleWebviewInboundMessage(raw: unknown): void {
  const parsed = parseWebviewMessage(raw)
  if (!parsed) {
    logIgnoredWebviewMessage(raw)
    return
  }
  dispatchWebviewInboundMessage(parsed)
}

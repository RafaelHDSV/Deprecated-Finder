/** Progress updates for the sidebar / panel UI (program build vs. per-file analysis). */
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

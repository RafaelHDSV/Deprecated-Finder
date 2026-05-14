import { Worker } from 'worker_threads'
import * as path from 'path'
import type { DeprecatedItem } from '../model/DeprecatedItem'
import { logScanDiagnostic } from '../../logging/deprecatedFinderLog'
import type { ScanProgressMessage } from './scanProgressTypes'
import type { ScanGroupWorkerPayload } from './scanGroupWorker'

const WORKER_SCRIPT = 'scanGroupWorker.js'

type WorkerFromChild =
  | {
      type: 'progress'
      update: ScanProgressMessage
    }
  | { type: 'done'; items: DeprecatedItem[]; progressCurrent: number }
  | { type: 'error'; message: string }

/**
 * Runs `createProgram` + per-file scan in a worker thread so the extension host
 * stays responsive: the caller can drive a heartbeat (elapsed time) while TypeScript compiles.
 */
export function collectProgramGroupInWorker(
  payload: ScanGroupWorkerPayload,
  reportProgress: (u: ScanProgressMessage) => void,
  heartbeatMessage: (elapsedSec: number) => ScanProgressMessage
): Promise<{ items: DeprecatedItem[]; progressCurrent: number }> {
  const workerFile = path.join(__dirname, WORKER_SCRIPT)

  return new Promise((resolve, reject) => {
    let settled = false
    let heartbeat: ReturnType<typeof setInterval> | undefined
    const startedAt = Date.now()

    const stopHeartbeat = () => {
      if (heartbeat !== undefined) {
        clearInterval(heartbeat)
        heartbeat = undefined
      }
    }

    const worker = new Worker(workerFile, { workerData: payload })

    const finish = (fn: () => void) => {
      if (settled) {
        return
      }
      settled = true
      stopHeartbeat()
      void worker.terminate().catch(() => {})
      fn()
    }

    const startHeartbeat = () => {
      stopHeartbeat()
      heartbeat = setInterval(() => {
        const elapsedSec = Math.floor((Date.now() - startedAt) / 1000)
        reportProgress(heartbeatMessage(elapsedSec))
      }, 1000)
    }

    startHeartbeat()

    worker.on('message', (msg: WorkerFromChild) => {
      if (msg.type === 'progress') {
        reportProgress(msg.update)
        if (msg.update.kind === 'indeterminate') {
          startHeartbeat()
        } else {
          stopHeartbeat()
        }
        return
      }
      if (msg.type === 'done') {
        finish(() =>
          resolve({ items: msg.items, progressCurrent: msg.progressCurrent })
        )
        return
      }
      if (msg.type === 'error') {
        finish(() => reject(new Error(msg.message)))
      }
    })

    worker.on('error', (err) => {
      finish(() => reject(err))
    })

    worker.on('exit', (code) => {
      if (!settled && code !== 0) {
        finish(() =>
          reject(new Error(`scanGroupWorker exited with code ${code}`))
        )
      }
    })
  })
}

export function logWorkerFallback(reason: string): void {
  logScanDiagnostic(`[Deprecated Finder] Worker scan fallback (sync): ${reason}`)
}

import * as path from 'path'
import * as ts from 'typescript'
import { parentPort, workerData } from 'worker_threads'
import type { DeprecatedItem } from '../model/DeprecatedItem'
import { normalizePathForComparison } from '../util/pathComparison'
import { scanFileForDeprecated } from './tsDeprecatedScanner'

export interface ScanGroupWorkerPayload {
  paths: string[]
  compilerOptions: ts.CompilerOptions
  narrative: 'default' | 'post-fix'
  progress: { current: number; total: number }
}

/** Smaller than full-workspace single `createProgram` — avoids multi-minute stalls. */
const ROOT_CHUNK_SIZE = 40

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

  const target = normalizePathForComparison(filePath)
  return program
    .getSourceFiles()
    .find((sf) => normalizePathForComparison(sf.fileName) === target)
}

function chunkRoots(paths: string[], size: number): string[][] {
  const out: string[][] = []
  for (let i = 0; i < paths.length; i += size) {
    out.push(paths.slice(i, i + size))
  }
  return out
}

function run(): void {
  const port = parentPort
  if (!port) {
    return
  }

  const data = workerData as ScanGroupWorkerPayload
  const narrative = data.narrative
  const postFix = narrative === 'post-fix'
  const determinatePrefix = postFix ? 'Re-scanning workspace' : undefined
  const progress = { current: data.progress.current, total: data.progress.total }
  const map = new Map<string, DeprecatedItem>()
  const scanStarted = Date.now()
  const elapsedSec = () => Math.floor((Date.now() - scanStarted) / 1000)

  const pathChunks = chunkRoots(data.paths, ROOT_CHUNK_SIZE)
  if (pathChunks.length === 0) {
    port.postMessage({
      type: 'done',
      items: [],
      progressCurrent: progress.current
    })
    return
  }

  const chunkCount = pathChunks.length

  try {
    for (let ci = 0; ci < pathChunks.length; ci++) {
      const chunk = pathChunks[ci]
      const chunkLabel =
        chunkCount > 1
          ? `Program ${ci + 1}/${chunkCount} (${chunk.length} root files)`
          : `Program (${chunk.length} root files)`

      port.postMessage({
        type: 'progress',
        update: {
          kind: 'indeterminate',
          message: postFix
            ? `Re-scanning workspace: ${chunkLabel} — compiling (${elapsedSec()}s elapsed)…`
            : `Building ${chunkLabel} — compiling (${elapsedSec()}s elapsed)…`,
          fileCount: data.paths.length
        }
      })

      const program = ts.createProgram(chunk, data.compilerOptions)

      for (const fp of chunk) {
        const sourceFile = getSourceFileForPath(program, fp)
        const short = path.basename(fp)

        if (!sourceFile || sourceFile.fileName.includes('node_modules')) {
          progress.current++
          port.postMessage({
            type: 'progress',
            update: {
              kind: 'determinate',
              current: Math.min(progress.current, progress.total),
              total: progress.total,
              statusText:
                determinatePrefix !== undefined
                  ? `${determinatePrefix}: ${Math.min(progress.current, progress.total)} / ${progress.total} (${elapsedSec()}s) — ${short}`
                  : `Scanning ${Math.min(progress.current, progress.total)} / ${progress.total} (${elapsedSec()}s) — ${short}`
            }
          })
          continue
        }

        const fileName = sourceFile.fileName
        const items = scanFileForDeprecated(fileName, program, sourceFile)
        for (const item of items) {
          map.set(item.id, item)
        }

        progress.current++
        port.postMessage({
          type: 'progress',
          update: {
            kind: 'determinate',
            current: Math.min(progress.current, progress.total),
            total: progress.total,
            statusText:
              determinatePrefix !== undefined
                ? `${determinatePrefix}: ${Math.min(progress.current, progress.total)} / ${progress.total} (${elapsedSec()}s) — ${short}`
                : `Scanning ${Math.min(progress.current, progress.total)} / ${progress.total} (${elapsedSec()}s) — ${short}`
          }
        })
      }
    }

    port.postMessage({
      type: 'done',
      items: Array.from(map.values()),
      progressCurrent: progress.current
    })
  } catch (e) {
    port.postMessage({
      type: 'error',
      message: e instanceof Error ? e.message : String(e)
    })
  }
}

run()

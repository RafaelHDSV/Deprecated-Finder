import { parentPort, workerData } from 'worker_threads'
import * as path from 'path'
import * as ts from 'typescript'
import type { DeprecatedItem } from '../model/DeprecatedItem'
import { normalizePathForComparison } from '../util/pathComparison'
import { scanFileForDeprecated } from './tsDeprecatedScanner'

export interface ScanGroupWorkerPayload {
  paths: string[]
  compilerOptions: ts.CompilerOptions
  narrative: 'default' | 'post-fix'
  progress: { current: number; total: number }
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

  const target = normalizePathForComparison(filePath)
  return program
    .getSourceFiles()
    .find((sf) => normalizePathForComparison(sf.fileName) === target)
}

function run(): void {
  const port = parentPort
  if (!port) {
    return
  }

  const data = workerData as ScanGroupWorkerPayload
  const narrative = data.narrative
  const determinatePrefix =
    narrative === 'post-fix' ? 'Re-scanning workspace' : undefined
  const progress = { current: data.progress.current, total: data.progress.total }
  const map = new Map<string, DeprecatedItem>()

  try {
    const program = ts.createProgram(data.paths, data.compilerOptions)

    for (const fp of data.paths) {
      const sourceFile = getSourceFileForPath(program, fp)
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
                ? `${determinatePrefix}: ${Math.min(progress.current, progress.total)} / ${progress.total} files…`
                : undefined
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
              ? `${determinatePrefix}: ${Math.min(progress.current, progress.total)} / ${progress.total} files…`
              : undefined
        }
      })
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

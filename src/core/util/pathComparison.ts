import * as path from 'path'

/**
 * Stable key for comparing file paths across VS Code URIs and TypeScript
 * `SourceFile.fileName`. On Windows the filesystem is case-insensitive, so we
 * lowercase; on POSIX we preserve casing for case-sensitive volumes.
 */
export function normalizePathForComparison(filePath: string): string {
  const unified = filePath.replace(/\\/g, '/')
  const normalized = path.normalize(unified).replace(/\\/g, '/')
  if (process.platform === 'win32') {
    return normalized.toLowerCase()
  }
  return normalized
}

import path from 'node:path'
import type { SourceFile } from 'ts-morph'

function withTsExtension(candidate: string): string | undefined {
  for (const extension of ['.ts', '.tsx']) {
    const file = `${candidate}${extension}`
    return file
  }
}

export function repoPath(sourceFile: SourceFile): string {
  return sourceFile.getFilePath().replace(/^\//, '')
}

export function resolveImportPath(fromFile: string, moduleSpecifier: string, files: Set<string>): string | undefined {
  if (!moduleSpecifier.startsWith('.')) {
    return undefined
  }

  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), moduleSpecifier))
  const direct = files.has(base) ? base : undefined

  if (direct) {
    return direct
  }

  for (const extension of ['.ts', '.tsx']) {
    const candidate = `${base}${extension}`

    if (files.has(candidate)) {
      return candidate
    }
  }

  return withTsExtension(base)
}

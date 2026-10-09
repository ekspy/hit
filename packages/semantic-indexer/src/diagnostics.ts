import type { Project } from 'ts-morph'
import { ts } from 'ts-morph'

import { enclosingFunctionRange, resolveDiagnosticProducer } from './diagnostic-origin.js'
import type { Diagnostic } from './types.js'

export function collectDiagnostics(project: Project, repoFiles: ReadonlySet<string> = new Set()): Diagnostic[] {
  const scopes: Array<{ diagnostic: Diagnostic; file?: string; scope?: { pos: number; end: number }; start?: number }> = []
  const diagnostics = project
    .getPreEmitDiagnostics()
    .filter((diagnostic) => !isExternalModuleResolutionDiagnostic(diagnostic.getCode(), flattenMessage(diagnostic.compilerObject.messageText)))
    .map((diagnostic) => {
      const sourceFile = diagnostic.getSourceFile()
      const start = diagnostic.getStart()
      const loc = sourceFile && start !== undefined ? sourceFile.getLineAndColumnAtPos(start) : undefined

      const producer = sourceFile && start !== undefined ? resolveDiagnosticProducer(sourceFile, start, repoFiles) : undefined
      const result: Diagnostic = {
        file: sourceFile?.getFilePath().replace(/^\//, ''),
        line: loc?.line,
        column: loc?.column,
        code: diagnostic.getCode(),
        message: flattenMessage(diagnostic.compilerObject.messageText),
        ...(producer ? { producer } : {}),
      }
      scopes.push({ diagnostic: result, file: result.file, scope: sourceFile && start !== undefined ? enclosingFunctionRange(sourceFile, start) : undefined, start })
      return result
    })

  inheritCascadeProducers(scopes)
  return diagnostics
}

/**
 * A diagnostic that resolves to no producer declaration, inside a function where another diagnostic does resolve, is
 * treated as a consequence of that one (e.g. "Function lacks ending return statement" once a `case` on a removed enum
 * member is itself an error, or a property read on a value whose inferred type broke at the call above). It inherits
 * the producer of the nearest preceding resolved diagnostic in the same function, or the nearest following one.
 */
function inheritCascadeProducers(entries: Array<{ diagnostic: Diagnostic; file?: string; scope?: { pos: number; end: number }; start?: number }>): void {
  for (const entry of entries) {
    if (entry.diagnostic.producer || !entry.scope || entry.start === undefined) {
      continue
    }

    const scope = entry.scope
    const resolved = entries
      .filter((other) => other !== entry && other.file === entry.file && other.start !== undefined && other.diagnostic.producer && other.diagnostic.producer.via !== 'cascade' && other.start >= scope.pos && other.start < scope.end)
      .sort((left, right) => distance(left.start!, entry.start!) - distance(right.start!, entry.start!))
    const source = resolved[0]?.diagnostic.producer

    if (source) {
      entry.diagnostic.producer = { ...source, via: 'cascade' }
    }
  }
}

function distance(other: number, start: number): number {
  // Preceding diagnostics first (causes come before their consequences), then following ones.
  return other <= start ? start - other : Number.MAX_SAFE_INTEGER / 2 + (other - start)
}

function isExternalModuleResolutionDiagnostic(code: number, message: string): boolean {
  if (code !== 2307) {
    return false
  }

  const moduleName = message.match(/Cannot find module '([^']+)'/)?.[1]
  return moduleName !== undefined && !moduleName.startsWith('.')
}

/**
 * Reads the compiler's own message (a string or a `ts.DiagnosticMessageChain`). ts-morph's `getMessageText()` wraps chains
 * in its own class, which `ts.flattenDiagnosticMessageText` does not understand (it yielded the text `undefined`).
 */
function flattenMessage(message: string | ts.DiagnosticMessageChain): string {
  return ts.flattenDiagnosticMessageText(message, ' ')
}

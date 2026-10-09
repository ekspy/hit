import type { Project } from 'ts-morph'
import { ts } from 'ts-morph'

import type { Diagnostic } from './types.js'

export function collectDiagnostics(project: Project): Diagnostic[] {
  return project
    .getPreEmitDiagnostics()
    .filter((diagnostic) => !isExternalModuleResolutionDiagnostic(diagnostic.getCode(), flattenMessage(diagnostic.compilerObject.messageText)))
    .map((diagnostic) => {
      const sourceFile = diagnostic.getSourceFile()
      const start = diagnostic.getStart()
      const loc = sourceFile && start !== undefined ? sourceFile.getLineAndColumnAtPos(start) : undefined

      return {
        file: sourceFile?.getFilePath().replace(/^\//, ''),
        line: loc?.line,
        column: loc?.column,
        code: diagnostic.getCode(),
        message: flattenMessage(diagnostic.compilerObject.messageText),
      }
    })
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

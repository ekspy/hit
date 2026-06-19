import type { Project } from 'ts-morph'
import ts from 'typescript'

import type { Diagnostic } from './types.js'

export function collectDiagnostics(project: Project): Diagnostic[] {
  return project
    .getPreEmitDiagnostics()
    .filter((diagnostic) => !isExternalModuleResolutionDiagnostic(diagnostic.getCode(), flattenMessage(diagnostic.getMessageText())))
    .map((diagnostic) => {
      const sourceFile = diagnostic.getSourceFile()
      const start = diagnostic.getStart()
      const loc = sourceFile && start !== undefined ? sourceFile.getLineAndColumnAtPos(start) : undefined

      return {
        file: sourceFile?.getFilePath().replace(/^\//, ''),
        line: loc?.line,
        column: loc?.column,
        code: diagnostic.getCode(),
        message: flattenMessage(diagnostic.getMessageText()),
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

function flattenMessage(message: unknown): string {
  return typeof message === 'string' ? message : ts.flattenDiagnosticMessageText(message as ts.DiagnosticMessageChain, ' ')
}

import type { Project } from 'ts-morph'

import type { Diagnostic } from './types.js'

export function collectDiagnostics(project: Project): Diagnostic[] {
  return project
    .getPreEmitDiagnostics()
    .filter((diagnostic) => !isExternalModuleResolutionDiagnostic(diagnostic.getCode(), diagnostic.getMessageText().toString()))
    .map((diagnostic) => {
      const sourceFile = diagnostic.getSourceFile()
      const start = diagnostic.getStart()
      const loc = sourceFile && start !== undefined ? sourceFile.getLineAndColumnAtPos(start) : undefined

      return {
        file: sourceFile?.getFilePath().replace(/^\//, ''),
        line: loc?.line,
        column: loc?.column,
        code: diagnostic.getCode(),
        message: diagnostic.getMessageText().toString(),
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

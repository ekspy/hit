import type { SourceFile } from 'ts-morph'

import { repoPath, resolveImportPath } from './dependencies.js'

export function collectDependencies(sourceFiles: SourceFile[], files: Set<string>): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>()

  for (const sourceFile of sourceFiles) {
    const fromFile = repoPath(sourceFile)
    const dependencies = new Set<string>()

    for (const importDeclaration of sourceFile.getImportDeclarations()) {
      const target = resolveImportPath(fromFile, importDeclaration.getModuleSpecifierValue(), files)

      if (target) {
        dependencies.add(target)
      }
    }

    graph.set(fromFile, dependencies)
  }

  return graph
}

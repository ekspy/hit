import type { SourceFile } from 'ts-morph'

import { repoPath, resolveImportPath } from './dependencies.js'
import type { Reference } from './types.js'

/** `knownSymbolIds` is built once per index by the caller, so collecting references stays linear in the number of files. */
export function collectReferences(sourceFile: SourceFile, files: Set<string>, knownSymbolIds: ReadonlySet<string>): Reference[] {
  const fromFile = repoPath(sourceFile)
  const refs: Reference[] = []
  const known = knownSymbolIds

  for (const importDeclaration of sourceFile.getImportDeclarations()) {
    const targetFile = resolveImportPath(fromFile, importDeclaration.getModuleSpecifierValue(), files)

    if (!targetFile) {
      continue
    }

    for (const namedImport of importDeclaration.getNamedImports()) {
      const importedName = namedImport.getNameNode().getText()
      const symbolId = `${targetFile}#${importedName}`

      if (!known.has(symbolId)) {
        continue
      }

      const start = namedImport.getNameNode().getStartLinePos()
      const pos = sourceFile.getLineAndColumnAtPos(start)
      refs.push({
        fromFile,
        symbolId,
        loc: {
          line: pos.line,
          column: pos.column,
        },
      })
    }
  }

  return refs
}

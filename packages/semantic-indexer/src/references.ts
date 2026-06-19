import type { SourceFile } from 'ts-morph'

import { repoPath, resolveImportPath } from './dependencies.js'
import type { Reference, SymbolInfo } from './types.js'

export function collectReferences(sourceFile: SourceFile, files: Set<string>, symbols: SymbolInfo[]): Reference[] {
  const fromFile = repoPath(sourceFile)
  const refs: Reference[] = []
  const known = new Map(symbols.map((symbol) => [symbol.id, symbol]))

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

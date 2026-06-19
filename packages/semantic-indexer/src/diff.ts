import type { SemanticDiff, SemanticIndexLike, SymbolInfo } from './index-types.js'

export function semanticDiff(before: SemanticIndexLike, after: SemanticIndexLike): SemanticDiff {
  const beforeSymbols = new Map(before.symbols().map((symbol) => [symbol.id, symbol]))
  const afterSymbols = new Map(after.symbols().map((symbol) => [symbol.id, symbol]))
  const added: SymbolInfo[] = []
  const removed: SymbolInfo[] = []
  const changed: Array<{ before: SymbolInfo; after: SymbolInfo }> = []

  for (const [id, symbol] of beforeSymbols) {
    const next = afterSymbols.get(id)

    if (!next) {
      removed.push(symbol)
      continue
    }

    if (symbol.signature !== next.signature || JSON.stringify(symbol.returnShape) !== JSON.stringify(next.returnShape)) {
      changed.push({ before: symbol, after: next })
    }
  }

  for (const [id, symbol] of afterSymbols) {
    if (!beforeSymbols.has(id)) {
      added.push(symbol)
    }
  }

  return { added, removed, changed }
}

export type { Diagnostic, Loc, Reference, SemanticDiff, SymbolChange, SymbolInfo, TypeShape } from './types.js'
export type { SemanticIndex } from './index.js'

export interface SemanticIndexLike {
  symbols(): import('./types.js').SymbolInfo[]
}

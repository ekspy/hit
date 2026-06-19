export interface Loc {
  line: number
  column: number
}

export interface TypeShape {
  text: string
  properties: Record<string, string>
}

export interface SymbolInfo {
  id: string
  name: string
  kind: 'function' | 'method' | 'class' | 'interface' | 'type' | 'const' | 'export'
  file: string
  signature: string
  returnShape?: TypeShape
  exported: boolean
}

export interface Reference {
  fromFile: string
  symbolId: string
  loc: Loc
}

export interface Diagnostic {
  file?: string
  line?: number
  column?: number
  code: number
  message: string
}

export interface SymbolChange {
  before: SymbolInfo
  after: SymbolInfo
}

export interface SemanticDiff {
  added: SymbolInfo[]
  removed: SymbolInfo[]
  changed: SymbolChange[]
}

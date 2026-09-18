export interface Loc {
  line: number
  column: number
}

export interface TypeShape {
  text: string
  properties: Record<string, string>
  /** Names of properties marked optional (`?`). Absent for shapes indexed before this field existed. */
  optional?: string[]
}

export interface ParameterInfo {
  name: string
  optional: boolean
  typeText: string
  /** Union members of the declared type (a single entry when the type is not a union). */
  unionMembers: string[]
}

export interface SymbolInfo {
  id: string
  name: string
  kind: 'function' | 'method' | 'class' | 'interface' | 'type' | 'const' | 'export'
  file: string
  signature: string
  returnShape?: TypeShape
  exported: boolean
  /** Structured parameter list (functions only). */
  parameters?: ParameterInfo[]
  /** Declared return type text (functions only), e.g. `Promise<PaymentResult>`. */
  returnTypeText?: string
  /** Property shape of interfaces and object-like type aliases. */
  shape?: TypeShape
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

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
  /** Type parameters with their constraint text (generic functions only). */
  typeParameters?: Array<{ name: string; constraint?: string }>
  /**
   * Public call signatures of an overloaded function (the implementation signature is not callable from outside),
   * each as `(params): return`. Absent for functions without overloads.
   */
  overloads?: Array<{ text: string; arity: number }>
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

/**
 * Declaration in another project file that the code flagged by a diagnostic uses, resolved with the type checker.
 * `symbol` is the top-level declaration name in `file`, `member` the path inside it (`Item` + `quantity`).
 * `via`: `call` (argument of a call to it), `import` (the import itself fails), `reference` (identifier, member
 * access or destructuring, possibly through local initializers), `cascade` (the diagnostic resolves to nothing,
 * and inherits the producer of another diagnostic in the same function).
 */
export interface DiagnosticProducer {
  file: string
  symbol?: string
  member?: string
  via: 'call' | 'import' | 'reference' | 'cascade'
}

export interface Diagnostic {
  file?: string
  line?: number
  column?: number
  code: number
  message: string
  producer?: DiagnosticProducer
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

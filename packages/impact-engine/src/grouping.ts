import type { Conflict, RuleId } from './conflicts.js'
import type { LabelConflict } from './labels.js'

export interface ConflictEvidence {
  files: Set<string>
  symbolTokens: Set<string>
  bareSymbols: Set<string>
  filePairs: Set<string>
  rules: Set<RuleId>
  /**
   * Identity of the compiler diagnostics behind diagnostic-derived conflicts
   * (`file:line:column:code`). Empty for diff-derived conflicts and labels.
   */
  diagnostics: Set<string>
}

export interface LogicalConflict {
  id: string
  primaryRule: RuleId
  level: 1 | 2 | 3
  severity: 'low' | 'medium' | 'high'
  evidence: ConflictEvidence
  conflicts: Conflict[]
}

const severityRank = new Map([
  ['high', 3],
  ['medium', 2],
  ['low', 1],
])

export function conflictEvidence(conflict: Conflict): ConflictEvidence {
  const files = new Set<string>()
  const symbolTokens = new Set<string>()
  const bareSymbols = new Set<string>()
  const rules = new Set<RuleId>([conflict.rule])

  files.add(conflict.origin.file)
  addSymbol(conflict.origin.symbolId, symbolTokens, bareSymbols)

  for (const affected of conflict.affected) {
    files.add(affected.file)
    addSymbol(affected.symbolId, symbolTokens, bareSymbols)
  }

  for (const identifier of quotedIdentifiers(conflict.reason)) {
    bareSymbols.add(identifier)
  }

  return {
    files,
    symbolTokens,
    bareSymbols,
    filePairs: filePairs(files),
    rules,
    diagnostics: diagnosticKeys(conflict),
  }
}

export function labelEvidence(label: LabelConflict): ConflictEvidence {
  const files = new Set<string>()
  const symbolTokens = new Set<string>()
  const bareSymbols = new Set<string>()
  const rules = new Set<RuleId>([label.rule])

  files.add(label.origin.file)
  addLabelSymbol(label.origin.file, label.origin.symbol, symbolTokens, bareSymbols)

  for (const affected of label.affected) {
    files.add(affected.file)
    addLabelSymbol(affected.file, affected.symbol, symbolTokens, bareSymbols)
  }

  return {
    files,
    symbolTokens,
    bareSymbols,
    filePairs: filePairs(files),
    rules,
    diagnostics: new Set<string>(),
  }
}

export function groupLogicalConflicts(conflicts: Conflict[]): LogicalConflict[] {
  const evidences = conflicts.map(conflictEvidence)
  const parent = conflicts.map((_, index) => index)

  for (let left = 0; left < conflicts.length; left += 1) {
    for (let right = left + 1; right < conflicts.length; right += 1) {
      if (connected(evidences[left]!, evidences[right]!)) {
        union(parent, left, right)
      }
    }
  }

  const groups = new Map<number, Conflict[]>()
  for (const [index, conflict] of conflicts.entries()) {
    const root = find(parent, index)
    groups.set(root, [...(groups.get(root) ?? []), conflict])
  }

  return [...groups.values()]
    .map((group, index) => logicalConflict(group, index))
    .sort((left, right) => left.id.localeCompare(right.id))
}

export function evidenceMatchScore(label: ConflictEvidence, logical: ConflictEvidence): 100 | 80 | 60 | 0 {
  if (intersects(label.symbolTokens, logical.symbolTokens)) {
    return 100
  }

  if (intersects(label.bareSymbols, logical.bareSymbols) && intersects(label.files, logical.files)) {
    return 80
  }

  if (intersects(label.filePairs, logical.filePairs) && hasSignal(label) && hasSignal(logical)) {
    return 60
  }

  return 0
}

function logicalConflict(conflicts: Conflict[], index: number): LogicalConflict {
  const evidence = mergeEvidence(conflicts.map(conflictEvidence))
  const primary = [...conflicts].sort(comparePrimary)[0]!

  return {
    id: `logical:${index + 1}:${[...evidence.files].sort().join(',')}:${[...evidence.bareSymbols].sort().join(',')}`,
    primaryRule: primary.rule,
    level: primary.level,
    severity: primary.severity,
    evidence,
    conflicts: [...conflicts].sort((left, right) => left.id.localeCompare(right.id)),
  }
}

function connected(left: ConflictEvidence, right: ConflictEvidence): boolean {
  if (intersects(left.symbolTokens, right.symbolTokens)) {
    return true
  }

  // Two diagnostic-derived conflicts with no resolved symbol on either side are
  // tied only by being the same diagnostic. Sharing files, a file pair or a
  // name quoted in the message (often a type name, as in "Property 'x' does
  // not exist on type 'T'") is not evidence of a single phenomenon: distinct
  // breaks between the same producer and consumer would otherwise be fused.
  if (unresolvedDiagnostic(left) && unresolvedDiagnostic(right) && !intersects(left.diagnostics, right.diagnostics)) {
    return false
  }

  if (intersects(left.bareSymbols, right.bareSymbols) && intersects(left.files, right.files)) {
    return true
  }

  // Both sides name their producer symbol and the symbols differ: two breaks between the same pair of files are
  // still two phenomena (a removed enum member and a renamed method in the same module, for instance).
  if (left.symbolTokens.size > 0 && right.symbolTokens.size > 0) {
    return false
  }

  if ((left.symbolTokens.size > 0 && right.symbolTokens.size === 0) || (right.symbolTokens.size > 0 && left.symbolTokens.size === 0)) {
    return intersects(left.files, right.files)
  }

  return intersects(left.filePairs, right.filePairs) && (hasSignal(left) || hasSignal(right))
}

function unresolvedDiagnostic(evidence: ConflictEvidence): boolean {
  return evidence.symbolTokens.size === 0 && evidence.diagnostics.size > 0
}

const diagnosticRules = new Set<RuleId>(['R3', 'R4', 'R9'])

function diagnosticKeys(conflict: Conflict): Set<string> {
  if (!diagnosticRules.has(conflict.rule)) {
    return new Set()
  }

  const code = conflict.reason.match(/^TypeScript diagnostic (\d+)/)?.[1] ?? '?'
  return new Set(conflict.affected.map((affected) => `${affected.file}:${affected.loc?.line ?? '-'}:${affected.loc?.column ?? '-'}:${code}`))
}

function mergeEvidence(evidences: ConflictEvidence[]): ConflictEvidence {
  const files = new Set<string>()
  const symbolTokens = new Set<string>()
  const bareSymbols = new Set<string>()
  const rules = new Set<RuleId>()
  const diagnostics = new Set<string>()

  for (const evidence of evidences) {
    for (const file of evidence.files) files.add(file)
    for (const token of evidence.symbolTokens) symbolTokens.add(token)
    for (const symbol of evidence.bareSymbols) bareSymbols.add(symbol)
    for (const rule of evidence.rules) rules.add(rule)
    for (const diagnostic of evidence.diagnostics) diagnostics.add(diagnostic)
  }

  return {
    files,
    symbolTokens,
    bareSymbols,
    filePairs: filePairs(files),
    rules,
    diagnostics,
  }
}

function addSymbol(symbolId: string | undefined, symbolTokens: Set<string>, bareSymbols: Set<string>): void {
  if (!symbolId) {
    return
  }

  symbolTokens.add(symbolId)
  const bare = symbolId.split('#').at(-1)

  if (bare) {
    addBareSymbol(bare, bareSymbols)
  }
}

function addLabelSymbol(file: string, symbol: string | undefined, symbolTokens: Set<string>, bareSymbols: Set<string>): void {
  if (!symbol) {
    return
  }

  symbolTokens.add(`${file}#${symbol}`)
  addBareSymbol(symbol, bareSymbols)
}

function addBareSymbol(symbol: string, bareSymbols: Set<string>): void {
  bareSymbols.add(symbol)
  const finalSegment = symbol.split('.').at(-1)

  if (finalSegment) {
    bareSymbols.add(finalSegment)
  }
}

function quotedIdentifiers(reason: string): string[] {
  return [...reason.matchAll(/'([^']+)'/g)].flatMap((match) => {
    const quoted = match[1]!

    if (/^[A-Za-z_$][\w$]*$/.test(quoted)) {
      return [quoted]
    }

    const basename = quoted.split('/').at(-1)?.replace(/\.[cm]?[tj]sx?$/, '')
    return basename && /^[A-Za-z_$][\w$]*$/.test(basename) ? [basename] : []
  })
}

function filePairs(files: Set<string>): Set<string> {
  const sorted = [...files].sort()
  const pairs = new Set<string>()

  for (let left = 0; left < sorted.length; left += 1) {
    for (let right = left + 1; right < sorted.length; right += 1) {
      pairs.add(`${sorted[left]}<->${sorted[right]}`)
    }
  }

  return pairs
}

function intersects<T>(left: Set<T>, right: Set<T>): boolean {
  for (const item of left) {
    if (right.has(item)) {
      return true
    }
  }

  return false
}

function hasSignal(evidence: ConflictEvidence): boolean {
  return evidence.symbolTokens.size > 0 || evidence.bareSymbols.size > 0
}

/**
 * Primary-rule selection inside a logical conflict, by certainty first:
 * a diff-derived rule proven breaking beats concrete compiler evidence, which
 * beats a diff-derived rule the classifier could not decide (`unknown`),
 * which beats generic diagnostics. Ties fall back to rule precedence
 * (call-site invalidating rules first), then level, severity and id.
 */
function comparePrimary(left: Conflict, right: Conflict): number {
  return (
    certaintyRank(left) - certaintyRank(right) ||
    primaryPrecedence.indexOf(left.rule) - primaryPrecedence.indexOf(right.rule) ||
    left.level - right.level ||
    (severityRank.get(right.severity) ?? 0) - (severityRank.get(left.severity) ?? 0) ||
    left.id.localeCompare(right.id)
  )
}

const primaryPrecedence: RuleId[] = ['R2', 'R6', 'R1', 'R5', 'R3', 'R4', 'R9', 'R8']
const diffDerivedRules = new Set<RuleId>(['R1', 'R2', 'R5', 'R6'])

function certaintyRank(conflict: Conflict): number {
  if (diffDerivedRules.has(conflict.rule)) {
    return conflict.classification === 'unknown' ? 2 : 0
  }

  if (conflict.rule === 'R3' || conflict.rule === 'R4') {
    return 1
  }

  return 3
}

function find(parent: number[], index: number): number {
  if (parent[index] !== index) {
    parent[index] = find(parent, parent[index]!)
  }

  return parent[index]!
}

function union(parent: number[], left: number, right: number): void {
  const leftRoot = find(parent, left)
  const rightRoot = find(parent, right)

  if (leftRoot !== rightRoot) {
    parent[rightRoot] = leftRoot
  }
}

import path from 'node:path'

import type { Diagnostic, SemanticDiff, SemanticIndex, SymbolChange, SymbolInfo } from '@hit/semantic-indexer'

import { classifyChange, parameterFindings, returnFindings, type CompatibilityFinding } from './compatibility.js'
import { conflictId, diagnosticAffected, type Conflict, type RuleId } from './conflicts.js'
import { ruleLevel, ruleSeverity } from './severity.js'

const typeMismatchCodes = new Set([2322, 2339, 2345, 2353, 2554, 2741])

export function analyzeRules(diff: SemanticDiff, index: SemanticIndex): Conflict[] {
  const conflicts = [
    ...signatureConflicts(diff, index),
    ...removedSymbolConflicts(diff, index),
    ...shapeConflicts(diff, index),
    ...diagnosticConflicts(diff, index),
  ]

  return dedupe(conflicts).sort((left, right) => left.id.localeCompare(right.id))
}

function signatureConflicts(diff: SemanticDiff, index: SemanticIndex): Conflict[] {
  return diff.changed
    .filter((change) => change.before.signature !== change.after.signature || JSON.stringify(change.before.returnShape) !== JSON.stringify(change.after.returnShape))
    .flatMap((change) => {
      const verdict = classifyChange(change)

      if (verdict.classification === 'compatible') {
        return []
      }

      const consumers = index.consumersOf(change.after.id)

      if (consumers.length === 0) {
        return []
      }

      const reason =
        change.before.signature === change.after.signature
          ? `Return shape changed for ${change.after.name} while signature text stayed ${change.after.signature}`
          : `Contract changed from ${change.before.signature} to ${change.after.signature}`

      return makeConflict('R1', change.after.file, change.after.id, consumers, withDetails(reason, verdict.findings), verdict.classification)
    })
}

function removedSymbolConflicts(diff: SemanticDiff, index: SemanticIndex): Conflict[] {
  return diff.removed.flatMap((symbol) => {
    const affected = affectedDiagnostics(index, symbol.name)

    if (affected.length === 0) {
      return []
    }

    return makeConflict('R2', symbol.file, symbol.id, affected, `Exported symbol ${symbol.name} was removed or renamed`, 'breaking')
  })
}

function shapeConflicts(diff: SemanticDiff, index: SemanticIndex): Conflict[] {
  return diff.changed.flatMap((change) => [...returnShapeConflict(change, index), ...narrowingConflict(change, index)])
}

function returnShapeConflict(change: SymbolChange, index: SemanticIndex): Conflict[] {
  if (JSON.stringify(change.before.returnShape) === JSON.stringify(change.after.returnShape)) {
    return []
  }

  const findings = returnFindings(change).filter((item) => item.aspect === 'return')
  const classification = aspectClassification(findings)

  if (classification === 'compatible') {
    return []
  }

  const consumers = index.consumersOf(change.after.id)

  if (consumers.length === 0) {
    return []
  }

  return makeConflict('R5', change.after.file, change.after.id, consumers, withDetails(`Return shape changed for ${change.after.name}`, findings), classification)
}

function narrowingConflict(change: SymbolChange, index: SemanticIndex): Conflict[] {
  const findings = parameterFindings(change)
  const narrowing = findings.filter((item) => item.verdict === 'breaking')

  if (narrowing.length === 0) {
    return []
  }

  const consumers = index.consumersOf(change.after.id)

  if (consumers.length === 0) {
    return []
  }

  return makeConflict('R6', change.after.file, change.after.id, consumers, withDetails(`Parameter contract narrowed for ${change.after.name}`, narrowing), 'breaking')
}

function diagnosticConflicts(diff: SemanticDiff, index: SemanticIndex): Conflict[] {
  const conflicts: Conflict[] = []

  for (const diagnostic of index.diagnostics()) {
    const affected = diagnosticAffected(diagnostic)

    if (!affected) {
      continue
    }

    const rule: RuleId = diagnostic.code === 2307 || diagnostic.code === 2305 ? 'R3' : typeMismatchCodes.has(diagnostic.code) ? 'R4' : 'R9'
    const origin = diagnosticOrigin(diagnostic, affected.file, diff, index) ?? { file: affected.file }
    conflicts.push({
      // Without a resolved producer symbol, the diagnostic position is part of the identity:
      // otherwise two distinct diagnostics with the same code in the same consumer collapse
      // into one conflict at deduplication. Resolved conflicts keep their position-free id.
      id: conflictId(rule, origin.file, origin.symbolId, [affected.file, String(diagnostic.code), ...(origin.symbolId ? [] : [diagnosticPosition(affected)])]),
      rule,
      level: ruleLevel(rule),
      severity: ruleSeverity(rule),
      origin,
      affected: [affected],
      reason: `TypeScript diagnostic ${diagnostic.code}: ${diagnostic.message}`,
      status: 'pending',
      classification: 'breaking',
    })
  }

  return conflicts
}

/**
 * Origin normalization: a diagnostic is reported on the consumer, but when the
 * diff contains a changed or removed producer symbol that the consumer file
 * references, the conflict originates at that producer.
 */
function diagnosticOrigin(diagnostic: Diagnostic, consumerFile: string, diff: SemanticDiff, index: SemanticIndex): Conflict['origin'] | undefined {
  const candidates: SymbolInfo[] = [...diff.changed.map((change) => change.after), ...diff.removed]

  if (candidates.length === 0) {
    return undefined
  }

  const mentioned = new Set(quotedIdentifiers(diagnostic.message))
  const dependencies = index.dependencyGraph().get(consumerFile) ?? new Set<string>()
  const consumes = (symbol: SymbolInfo): boolean => index.consumersOf(symbol.id).some((reference) => reference.fromFile === consumerFile)
  const dependsOn = (symbol: SymbolInfo): boolean => symbol.file !== consumerFile && dependencies.has(symbol.file)
  const tiers: Array<(symbol: SymbolInfo) => boolean> = [
    (symbol) => consumes(symbol) && mentioned.has(symbol.name),
    (symbol) => consumes(symbol),
    (symbol) => mentioned.has(symbol.name) && (dependsOn(symbol) || isRemoved(symbol, diff)),
  ]

  for (const tier of tiers) {
    const match = candidates.filter(tier).sort((left, right) => left.id.localeCompare(right.id))[0]

    if (match) {
      return { file: match.file, symbolId: match.id }
    }
  }

  if (diagnostic.code === 2307) {
    const producerFile = missingModuleFile(diagnostic.message, consumerFile, diff.removed)

    if (producerFile) {
      return { file: producerFile }
    }
  }

  return undefined
}

function missingModuleFile(message: string, consumerFile: string, removed: SymbolInfo[]): string | undefined {
  const specifier = message.match(/Cannot find module '([^']+)'/)?.[1]

  if (!specifier || !specifier.startsWith('.')) {
    return undefined
  }

  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(consumerFile), specifier))
  return removed.map((symbol) => symbol.file).find((file) => file === resolved || file.replace(/\.[cm]?[tj]sx?$/, '') === resolved)
}

function diagnosticPosition(affected: { loc?: { line: number; column: number } }): string {
  return affected.loc ? `${affected.loc.line}:${affected.loc.column}` : '-'
}

function isRemoved(symbol: SymbolInfo, diff: SemanticDiff): boolean {
  return diff.removed.some((removed) => removed.id === symbol.id)
}

function quotedIdentifiers(message: string): string[] {
  return [...message.matchAll(/'([^']+)'/g)].map((match) => match[1]!).filter((quoted) => /^[A-Za-z_$][\w$]*$/.test(quoted))
}

function affectedDiagnostics(index: SemanticIndex, symbolName: string): Array<{ file: string; loc?: { line: number; column: number } }> {
  return index
    .diagnostics()
    .filter((diagnostic) => diagnostic.message.includes(symbolName))
    .flatMap((diagnostic) => {
      const affected = diagnosticAffected(diagnostic)
      return affected ? [affected] : []
    })
}

function makeConflict(
  rule: RuleId,
  originFile: string,
  symbolId: string | undefined,
  affected: Array<{ fromFile?: string; file?: string; loc?: { line: number; column: number }; symbolId?: string }>,
  reason: string,
  classification: 'breaking' | 'unknown',
): Conflict[] {
  const normalized = affected.map((item) => ({
    file: item.file ?? item.fromFile ?? originFile,
    loc: item.loc,
    symbolId: item.symbolId,
  }))

  return [
    {
      id: conflictId(rule, originFile, symbolId, normalized.map((item) => item.file).sort()),
      rule,
      level: ruleLevel(rule),
      severity: ruleSeverity(rule),
      origin: { file: originFile, symbolId },
      affected: normalized,
      reason,
      status: 'pending',
      classification,
    },
  ]
}

function aspectClassification(findings: CompatibilityFinding[]): 'breaking' | 'compatible' | 'unknown' {
  if (findings.some((item) => item.verdict === 'breaking')) {
    return 'breaking'
  }

  if (findings.length === 0 || findings.some((item) => item.verdict === 'unknown')) {
    return 'unknown'
  }

  return 'compatible'
}

function withDetails(reason: string, findings: CompatibilityFinding[]): string {
  const details = findings.filter((item) => item.verdict !== 'compatible').map((item) => item.detail)
  return details.length > 0 ? `${reason} (${details.join('; ')})` : reason
}

function dedupe(conflicts: Conflict[]): Conflict[] {
  return [...new Map(conflicts.map((conflict) => [conflict.id, conflict])).values()]
}

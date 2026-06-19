import type { SemanticDiff, SemanticIndex, SymbolChange, SymbolInfo } from '@hit/semantic-indexer'

import { conflictId, diagnosticAffected, type Conflict, type RuleId } from './conflicts.js'
import { ruleLevel, ruleSeverity } from './severity.js'

const typeMismatchCodes = new Set([2322, 2339, 2345, 2353, 2554, 2741])

export function analyzeRules(diff: SemanticDiff, index: SemanticIndex): Conflict[] {
  const conflicts = [
    ...signatureConflicts(diff, index),
    ...removedSymbolConflicts(diff, index),
    ...shapeConflicts(diff, index),
    ...diagnosticConflicts(index),
  ]

  return dedupe(conflicts).sort((left, right) => left.id.localeCompare(right.id))
}

function signatureConflicts(diff: SemanticDiff, index: SemanticIndex): Conflict[] {
  return diff.changed
    .filter((change) => change.before.signature !== change.after.signature)
    .flatMap((change) => {
      const consumers = index.consumersOf(change.after.id)

      if (consumers.length === 0) {
        return []
      }

      return makeConflict('R1', change.after.file, change.after.id, consumers, `Signature changed from ${change.before.signature} to ${change.after.signature}`)
    })
}

function removedSymbolConflicts(diff: SemanticDiff, index: SemanticIndex): Conflict[] {
  return diff.removed.flatMap((symbol) => {
    const affected = affectedDiagnostics(index, symbol.name)

    if (affected.length === 0) {
      return []
    }

    return makeConflict('R2', symbol.file, symbol.id, affected, `Exported symbol ${symbol.name} was removed or renamed`)
  })
}

function shapeConflicts(diff: SemanticDiff, index: SemanticIndex): Conflict[] {
  return diff.changed.flatMap((change) => [...returnShapeConflict(change, index), ...narrowingConflict(change, index)])
}

function returnShapeConflict(change: SymbolChange, index: SemanticIndex): Conflict[] {
  if (JSON.stringify(change.before.returnShape) === JSON.stringify(change.after.returnShape)) {
    return []
  }

  const consumers = index.consumersOf(change.after.id)

  if (consumers.length === 0) {
    return []
  }

  return makeConflict('R5', change.after.file, change.after.id, consumers, `Return shape changed for ${change.after.name}`)
}

function narrowingConflict(change: SymbolChange, index: SemanticIndex): Conflict[] {
  const beforeOptional = optionalParameterNames(change.before.signature)
  const afterOptional = optionalParameterNames(change.after.signature)
  const beforeCount = parameterCount(change.before.signature)
  const afterCount = parameterCount(change.after.signature)
  const optionalRemoved = [...beforeOptional].some((name) => !afterOptional.has(name))

  if (!optionalRemoved && afterCount <= beforeCount) {
    return []
  }

  const consumers = index.consumersOf(change.after.id)

  if (consumers.length === 0) {
    return []
  }

  return makeConflict('R6', change.after.file, change.after.id, consumers, `Parameter contract narrowed for ${change.after.name}`)
}

function diagnosticConflicts(index: SemanticIndex): Conflict[] {
  const conflicts: Conflict[] = []

  for (const diagnostic of index.diagnostics()) {
    const affected = diagnosticAffected(diagnostic)

    if (!affected) {
      continue
    }

    const rule: RuleId = diagnostic.code === 2307 || diagnostic.code === 2305 ? 'R3' : typeMismatchCodes.has(diagnostic.code) ? 'R4' : 'R9'
    conflicts.push({
      id: conflictId(rule, affected.file, undefined, [affected.file, String(diagnostic.code)]),
      rule,
      level: ruleLevel(rule),
      severity: ruleSeverity(rule),
      origin: { file: affected.file },
      affected: [affected],
      reason: `TypeScript diagnostic ${diagnostic.code}: ${diagnostic.message}`,
      status: 'pending',
    })
  }

  return conflicts
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
    },
  ]
}

function parameterCount(signature: string): number {
  const params = signature.match(/\((.*)\)/)?.[1].trim()
  return params ? params.split(',').length : 0
}

function optionalParameterNames(signature: string): Set<string> {
  const params = signature.match(/\((.*)\)/)?.[1].trim()

  if (!params) {
    return new Set()
  }

  return new Set(
    params
      .split(',')
      .map((param) => param.trim().match(/^(\w+)\?/)?.[1])
      .filter((name): name is string => Boolean(name)),
  )
}

function dedupe(conflicts: Conflict[]): Conflict[] {
  return [...new Map(conflicts.map((conflict) => [conflict.id, conflict])).values()]
}

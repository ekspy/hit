import path from 'node:path'

import type { Diagnostic, SemanticDiff, SemanticIndex, SymbolChange, SymbolInfo } from '@hit/semantic-indexer'

import { classifyChange, parameterFindings, returnFindings, type CompatibilityFinding } from './compatibility.js'
import { conflictId, diagnosticAffected, type Conflict, type RuleId } from './conflicts.js'
import { ruleLevel, ruleSeverity } from './severity.js'

/**
 * Diagnostics that report a value, call or member incompatible with the type it meets: assignability, missing or
 * unknown members, arity, overload resolution and operand types.
 */
const typeMismatchCodes = new Set([2322, 2339, 2345, 2353, 2362, 2363, 2365, 2367, 2551, 2554, 2555, 2559, 2739, 2740, 2741, 2769])
/** Diagnostics that report an import no longer resolving to what the module exports (module, named or default export). */
const importCodes = new Set([1192, 2305, 2307, 2613, 2614, 2724])

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

      const consumers = corroboratedConsumers(index.consumersOf(change.after.id), verdict.classification, index)

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

/**
 * A change the classifier could not decide (`unknown`) is only reported to consumers the type checker does not accept:
 * the index holds the consumers' current code, so a consumer file without any diagnostic type-checks against the new
 * contract and an undecided change is, for that code, compatible. Proven-breaking changes keep every consumer, since
 * they warn before the consumer writes code that relies on the old contract.
 */
function corroboratedConsumers<T extends { fromFile: string }>(consumers: T[], classification: 'breaking' | 'compatible' | 'unknown', index: SemanticIndex): T[] {
  if (classification !== 'unknown') {
    return consumers
  }

  const flagged = new Set(index.diagnostics().flatMap((diagnostic) => (diagnostic.file ? [diagnostic.file] : [])))
  return consumers.filter((consumer) => flagged.has(consumer.fromFile))
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

  const consumers = corroboratedConsumers(index.consumersOf(change.after.id), classification, index)

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

    const rule: RuleId = importCodes.has(diagnostic.code) ? 'R3' : typeMismatchCodes.has(diagnostic.code) ? 'R4' : 'R9'
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
      reason: `TypeScript diagnostic ${diagnostic.code}: ${diagnostic.message}${producerNote(diagnostic, affected.file)}`,
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
  const producer = diagnostic.producer

  // The checker resolved the flagged code to the declaration it uses in another file: that is the origin, however
  // many files the value crossed to get there, and whether or not the declaration is among the indexed symbols.
  if (producer && producer.file !== consumerFile) {
    if (!producer.symbol) {
      return { file: producer.file }
    }

    const resolvedId = `${producer.file}#${producer.symbol}`
    const entry = consumedEntryPoint(resolvedId, producer.symbol, consumerFile, diff, index)
    return entry ? { file: entry.file, symbolId: entry.id } : { file: producer.file, symbolId: resolvedId }
  }

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

/**
 * The checker names the nearest declaration (often a type such as `PaymentResult`), but the consumer may only reach it
 * through a changed symbol it imports whose contract exposes that type (`createPayment(): PaymentResult`). Then the
 * imported symbol is the origin, so the diagnostic and the diff-derived conflict on that symbol describe one change.
 */
function consumedEntryPoint(resolvedId: string, resolvedName: string, consumerFile: string, diff: SemanticDiff, index: SemanticIndex): SymbolInfo | undefined {
  const consumes = (id: string): boolean => index.consumersOf(id).some((reference) => reference.fromFile === consumerFile)

  if (consumes(resolvedId)) {
    return undefined
  }

  const word = new RegExp(`\\b${resolvedName.replace(/[$]/g, '\\$&')}\\b`)
  return [...diff.changed.map((change) => change.after), ...diff.removed]
    .filter((symbol) => symbol.id !== resolvedId && consumes(symbol.id) && word.test(`${symbol.signature} ${symbol.returnTypeText ?? ''}`))
    .sort((left, right) => left.id.localeCompare(right.id))[0]
}

function producerNote(diagnostic: Diagnostic, consumerFile: string): string {
  const producer = diagnostic.producer

  if (!producer || producer.file === consumerFile || !producer.symbol) {
    return ''
  }

  const member = producer.member ? ` member '${producer.member.split('.').at(-1)}' (${producer.symbol}.${producer.member}) of` : ''
  return ` [uses${member} '${producer.symbol}' declared in ${producer.file}, resolved by ${producer.via}]`
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

import type { Conflict, RuleId } from './conflicts.js'
import { evidenceMatchScore, groupLogicalConflicts, labelEvidence, type LogicalConflict } from './grouping.js'

export interface LabelConflict {
  rule: RuleId
  /**
   * Other rules that also describe this phenomenon legitimately (e.g. a union
   * value removal provable from the diff, R1, that also surfaces as a type
   * error at the use site, R4). `rule` stays the reference; attribution is
   * reported both strictly (only `rule`) and accepting these alternatives.
   */
  acceptableRules?: RuleId[]
  level: 1 | 2 | 3
  rationale?: string
  origin: {
    file: string
    symbol?: string
  }
  affected: Array<{
    file: string
    symbol?: string
  }>
}

export interface LabelsFile {
  conflicts: LabelConflict[]
}

export interface QualityReport {
  precision: number
  recall: number
  f1: number
  truePositives: number
  falsePositives: number
  falseNegatives: number
  logicalConflicts: LogicalConflict[]
  matches: LabelMatch[]
  ruleAttribution: RuleAttributionReport
  /** Rule attribution counting a primary rule listed in `acceptableRules` as correct. */
  ruleAttributionAcceptable: RuleAttributionReport
  rawRuleFirings: Record<string, { expected: number; actual: number; matched: number }>
  byRule: Record<string, { expected: number; actual: number; matched: number }>
}

export interface LabelMatch {
  labelIndex: number
  logicalConflictId: string
  score: 100 | 80 | 60
  expectedRule: RuleId
  acceptableRules: RuleId[]
  primaryRule: RuleId
  rawRules: RuleId[]
}

export interface RuleAttributionReport {
  correct: number
  total: number
  accuracy: number
}

export function scoreConflicts(actual: Conflict[], expected: LabelConflict[]): QualityReport {
  const logicalConflicts = groupLogicalConflicts(actual)
  const matches = matchLabels(expected, logicalConflicts)
  const truePositives = matches.length
  const falsePositives = logicalConflicts.length - truePositives
  const falseNegatives = expected.length - truePositives
  const precision = logicalConflicts.length === 0 ? 1 : truePositives / logicalConflicts.length
  const recall = expected.length === 0 ? 1 : truePositives / expected.length
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall)
  const rawRuleFirings = byRule(actual, expected)
  const ruleAttribution = attribution(matches)
  const ruleAttributionAcceptable = attribution(matches, true)

  return {
    precision,
    recall,
    f1,
    truePositives,
    falsePositives,
    falseNegatives,
    logicalConflicts,
    matches,
    ruleAttribution,
    ruleAttributionAcceptable,
    rawRuleFirings,
    byRule: rawRuleFirings,
  }
}

export function matchLabels(expected: LabelConflict[], logicalConflicts: LogicalConflict[]): LabelMatch[] {
  const candidates = expected.flatMap((label, labelIndex) => {
    const labelEv = labelEvidence(label)

    return logicalConflicts.flatMap((logical) => {
      const score = evidenceMatchScore(labelEv, logical.evidence)
      return score > 0 ? [{ labelIndex, logical, score: score as 100 | 80 | 60 }] : []
    })
  })

  candidates.sort(
    (left, right) =>
      right.score - left.score ||
      left.labelIndex - right.labelIndex ||
      left.logical.id.localeCompare(right.logical.id),
  )

  const usedLabels = new Set<number>()
  const usedLogical = new Set<string>()
  const matches: LabelMatch[] = []

  for (const candidate of candidates) {
    if (usedLabels.has(candidate.labelIndex) || usedLogical.has(candidate.logical.id)) {
      continue
    }

    usedLabels.add(candidate.labelIndex)
    usedLogical.add(candidate.logical.id)
    matches.push({
      labelIndex: candidate.labelIndex,
      logicalConflictId: candidate.logical.id,
      score: candidate.score,
      expectedRule: expected[candidate.labelIndex]!.rule,
      acceptableRules: expected[candidate.labelIndex]!.acceptableRules ?? [],
      primaryRule: candidate.logical.primaryRule,
      rawRules: [...new Set(candidate.logical.conflicts.map((conflict) => conflict.rule))],
    })
  }

  return matches.sort((left, right) => left.labelIndex - right.labelIndex || left.logicalConflictId.localeCompare(right.logicalConflictId))
}

function labelKeys(label: LabelConflict): string[] {
  return label.affected.map((affected) => [label.rule, label.origin.file, label.origin.symbol ?? '', affected.file].join('|'))
}

function conflictKeys(conflict: Conflict): string[] {
  const originSymbol = conflict.origin.symbolId?.split('#').at(-1) ?? ''
  return conflict.affected.map((affected) => [conflict.rule, conflict.origin.file, originSymbol, affected.file].join('|'))
}

function byRule(actual: Conflict[], expected: LabelConflict[]): QualityReport['byRule'] {
  const rules = new Set([...actual.map((conflict) => conflict.rule), ...expected.map((label) => label.rule)])
  const report: QualityReport['byRule'] = {}

  for (const rule of rules) {
    const expectedForRule = expected.filter((label) => label.rule === rule)
    const actualForRule = actual.filter((conflict) => conflict.rule === rule)
    const expectedKeys = new Set(expectedForRule.flatMap(labelKeys))
    const matched = actualForRule.flatMap(conflictKeys).filter((key) => expectedKeys.has(key)).length
    report[rule] = {
      expected: expectedForRule.flatMap(labelKeys).length,
      actual: actualForRule.flatMap(conflictKeys).length,
      matched,
    }
  }

  return report
}

function attribution(matches: LabelMatch[], acceptAlternatives = false): RuleAttributionReport {
  const correct = matches.filter(
    (match) => match.expectedRule === match.primaryRule || (acceptAlternatives && match.acceptableRules.includes(match.primaryRule)),
  ).length
  const total = matches.length

  return {
    correct,
    total,
    accuracy: total === 0 ? 1 : correct / total,
  }
}

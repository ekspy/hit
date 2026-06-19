import type { Conflict, RuleId } from './conflicts.js'

export interface LabelConflict {
  rule: RuleId
  level: 1 | 2 | 3
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
  byRule: Record<string, { expected: number; actual: number; matched: number }>
}

export function scoreConflicts(actual: Conflict[], expected: LabelConflict[]): QualityReport {
  const expectedKeys = expected.flatMap(labelKeys)
  const actualKeys = actual.flatMap(conflictKeys)
  const unmatchedExpected = new Set(expectedKeys)
  let truePositives = 0

  for (const key of actualKeys) {
    if (unmatchedExpected.delete(key)) {
      truePositives += 1
    }
  }

  const falsePositives = actualKeys.length - truePositives
  const falseNegatives = expectedKeys.length - truePositives
  const precision = actualKeys.length === 0 ? 1 : truePositives / actualKeys.length
  const recall = expectedKeys.length === 0 ? 1 : truePositives / expectedKeys.length
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall)

  return {
    precision,
    recall,
    f1,
    truePositives,
    falsePositives,
    falseNegatives,
    byRule: byRule(actual, expected),
  }
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

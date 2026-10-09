/**
 * C31: how many changed symbols the compatibility classifier marks as
 * compatible, breaking (incompatible) or unknown, how many raw conflicts carry
 * the `unknown` classification, and whether any logical conflict that relies
 * on an `unknown` classification ends up as a false positive.
 */
import { classifyChange, ImpactEngine, scoreConflicts, type LabelsFile } from '@hit/impact-engine'
import { SemanticIndex, semanticDiff } from '@hit/semantic-indexer'

import { table, writeReport } from './report.js'
import { applyScript, listScenarioIds, loadAgentScript, loadFixtureRepo, loadLabelsFile, loadScenario, type ScenarioSet } from './scenario.js'

interface ScenarioCounts {
  id: string
  changedSymbols: Array<{ symbol: string; classification: string; findings: string[] }>
  rawConflicts: number
  rawUnknown: number
  logicalConflicts: number
  logicalWithUnknown: number
  /** Logical conflicts whose diff-derived evidence is only `unknown` (no proof of breakage). */
  logicalOnlyUnknown: number
  falsePositives: number
  falsePositivesWithUnknown: number
  falsePositivesOnlyUnknown: number
  unknownFalsePositives: Array<{ logicalId: string; rules: string[]; reasons: string[] }>
}

const diffRules = new Set(['R1', 'R2', 'R5', 'R6'])

function countScenario(id: string, set: ScenarioSet): ScenarioCounts {
  const repo = loadFixtureRepo(loadScenario(id, set).fixture, `c31-${id}`)
  const before = SemanticIndex.build(repo)
  for (const agentId of ['agent-a', 'agent-b']) {
    applyScript(repo, loadAgentScript(id, agentId, set))
  }
  const after = SemanticIndex.build(repo)
  const diff = semanticDiff(before, after)
  const conflicts = new ImpactEngine().analyze(diff, after)
  const labels = loadLabelsFile<LabelsFile>(id, set).conflicts
  const score = scoreConflicts(conflicts, labels)
  const matched = new Set(score.matches.map((match) => match.logicalConflictId))
  const hasUnknown = (group: (typeof score.logicalConflicts)[number]) => group.conflicts.some((conflict) => conflict.classification === 'unknown')
  const onlyUnknown = (group: (typeof score.logicalConflicts)[number]) => {
    const diffDerived = group.conflicts.filter((conflict) => diffRules.has(conflict.rule))
    const diagnostics = group.conflicts.filter((conflict) => !diffRules.has(conflict.rule))
    return diffDerived.length > 0 && diagnostics.length === 0 && diffDerived.every((conflict) => conflict.classification === 'unknown')
  }
  const falsePositives = score.logicalConflicts.filter((group) => !matched.has(group.id))

  return {
    id,
    changedSymbols: diff.changed.map((change) => {
      const verdict = classifyChange(change)
      return {
        symbol: change.after.id,
        classification: verdict.classification,
        findings: verdict.findings.map((finding) => `${finding.verdict}: ${finding.detail}`.slice(0, 200)),
      }
    }),
    rawConflicts: conflicts.length,
    rawUnknown: conflicts.filter((conflict) => conflict.classification === 'unknown').length,
    logicalConflicts: score.logicalConflicts.length,
    logicalWithUnknown: score.logicalConflicts.filter(hasUnknown).length,
    logicalOnlyUnknown: score.logicalConflicts.filter(onlyUnknown).length,
    falsePositives: falsePositives.length,
    falsePositivesWithUnknown: falsePositives.filter(hasUnknown).length,
    falsePositivesOnlyUnknown: falsePositives.filter(onlyUnknown).length,
    unknownFalsePositives: falsePositives.filter(hasUnknown).map((group) => ({
      logicalId: group.id,
      rules: group.conflicts.map((conflict) => `${conflict.rule}${conflict.classification ? `(${conflict.classification})` : ''}`),
      reasons: group.conflicts.map((conflict) => conflict.reason.slice(0, 160)),
    })),
  }
}

function summarise(rows: ScenarioCounts[]) {
  const symbols = rows.flatMap((row) => row.changedSymbols)
  const by = (classification: string) => symbols.filter((symbol) => symbol.classification === classification).length
  const sum = (key: keyof ScenarioCounts) => rows.reduce((total, row) => total + (row[key] as number), 0)
  return {
    changedSymbols: symbols.length,
    compatible: by('compatible'),
    incompatible: by('breaking'),
    unknown: by('unknown'),
    rawConflicts: sum('rawConflicts'),
    rawUnknown: sum('rawUnknown'),
    logicalConflicts: sum('logicalConflicts'),
    logicalWithUnknown: sum('logicalWithUnknown'),
    logicalOnlyUnknown: sum('logicalOnlyUnknown'),
    falsePositives: sum('falsePositives'),
    falsePositivesWithUnknown: sum('falsePositivesWithUnknown'),
    falsePositivesOnlyUnknown: sum('falsePositivesOnlyUnknown'),
  }
}

export function writeClassificationCounts(): void {
  const sets: ScenarioSet[] = ['dev', 'heldout']
  const result = Object.fromEntries(
    sets.map((set) => {
      const rows = listScenarioIds(set).map((id) => countScenario(id, set))
      return [set, { summary: summarise(rows), scenarios: rows }]
    }),
  ) as Record<ScenarioSet, { summary: ReturnType<typeof summarise>; scenarios: ScenarioCounts[] }>

  writeReport(
    'classification-counts',
    result,
    `# Compatibility classification counts (C31)

${table(
  ['Set', 'Changed symbols', 'Compatible', 'Incompatible', 'Unknown', 'Raw conflicts', 'Raw unknown', 'Logical', 'Logical w/ unknown', 'Logical only-unknown', 'FP', 'FP w/ unknown', 'FP only-unknown'],
  sets.map((set) => {
    const s = result[set].summary
    return [set, s.changedSymbols, s.compatible, s.incompatible, s.unknown, s.rawConflicts, s.rawUnknown, s.logicalConflicts, s.logicalWithUnknown, s.logicalOnlyUnknown, s.falsePositives, s.falsePositivesWithUnknown, s.falsePositivesOnlyUnknown]
  }),
)}

${sets
  .map(
    (set) => `## ${set}

${table(
  ['Scenario', 'Changed symbols (classification)', 'Raw unknown', 'FP', 'FP w/ unknown'],
  result[set].scenarios.map((row) => [row.id, row.changedSymbols.map((symbol) => `${symbol.symbol.split('#').at(-1)}:${symbol.classification}`).join(', ') || '-', row.rawUnknown, row.falsePositives, row.falsePositivesWithUnknown]),
)}`,
  )
  .join('\n\n')}
`,
  )
}

if (import.meta.url === `file://${process.argv[1]}`) {
  writeClassificationCounts()
}

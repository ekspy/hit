import path from 'node:path'

import { ImpactEngine, scoreConflicts, type Conflict, type LabelsFile, type LogicalConflict, type QualityReport } from '@hit/impact-engine'
import { Repo } from '@hit/repo-crdt'
import { SemanticIndex, semanticDiff } from '@hit/semantic-indexer'

import { propagationBench } from './bench.js'
import { gitPilot } from './git-baseline.js'
import { table, writeReport } from './report.js'
import { applyScript, listScenarioIds, loadAgentScript, loadFixtureRepo, loadLabelsFile, loadScenario, runScenario, type ScenarioSet } from './scenario.js'

const scenarios = [
  '01-return-type-change',
  '02-symbol-rename',
  '03-removed-field',
  '04-symbol-move',
  '05-optional-to-required',
  '06-widen-to-narrow-type',
  '07-async-contract-change',
  '08-import-path-change',
  '09-union-value-removed',
  '10-compatible-change-control',
  '11-added-optional-param-control',
  '12-added-optional-return-field-control',
  '13-widened-param-type-control',
  '14-interface-field-rename',
  '15-enum-like-union-added-and-consumer-exhaustive',
  '16-two-producers-one-consumer',
]


export async function runAnalyses(): Promise<void> {
  writeConvergenceReport()
  writeDetectorQualityReport()
  writePropagationLatencyReport()
  await writeGitPilotReport()
}

function writeConvergenceReport(): void {
  const two = convergenceCase(['agent-a', 'agent-b'])
  const three = convergenceCase(['agent-a', 'agent-b', 'agent-c'])
  const json = {
    seed: 1701,
    cases: [two, three],
  }
  writeReport(
    'convergence',
    json,
    `# Convergence

${table(['Replicas', 'Visible files equal', 'Operations equal', 'Active claims equal'], json.cases.map((item) => [item.replicas, String(item.visibleFilesEqual), String(item.operationsEqual), String(item.activeClaimsEqual)]))}
`,
  )
}

function convergenceCase(actorIds: string[]): {
  replicas: number
  visibleFilesEqual: boolean
  operationsEqual: boolean
  activeClaimsEqual: boolean
} {
  const repos = actorIds.map((actorId) => Repo.create(actorId))
  repos[0]?.createFile('src/a.ts', 'export const a = 1\n', 'ts')
  const taskId = repos[0]?.createTask({ title: 'Coordinate checkout', description: 'Demo task' }) ?? ''

  for (let index = 1; index < repos.length; index += 1) {
    repos[0]?.syncWith(repos[index]!)
  }

  repos[0]?.editFile('src/a.ts', { start: 17, deleteCount: 1, insert: '2' })
  repos[1]?.createFile('src/b.ts', 'export const b = 1\n', 'ts')
  repos.at(-1)?.claimTask(taskId)

  for (const left of repos) {
    for (const right of repos) {
      if (left !== right) {
        left.syncWith(right)
      }
    }
  }

  const snapshots = repos.map((repo) => ({
    files: repo.listFiles().map((file) => [file, repo.fileContent(file)]),
    operations: repo.getOperationLog(),
    claim: repo.activeClaim(taskId),
  }))
  const first = JSON.stringify(snapshots[0])

  return {
    replicas: repos.length,
    visibleFilesEqual: snapshots.every((snapshot) => JSON.stringify(snapshot.files) === JSON.stringify(snapshots[0]?.files)),
    operationsEqual: snapshots.every((snapshot) => JSON.stringify(snapshot.operations) === JSON.stringify(snapshots[0]?.operations)),
    activeClaimsEqual: snapshots.every((snapshot) => JSON.stringify(snapshot.claim) === JSON.stringify(snapshots[0]?.claim)) && snapshots.every((snapshot) => JSON.stringify(snapshot) === first),
  }
}

export function writeDetectorQualityReport(set: ScenarioSet = 'dev', reportName = 'detector-quality'): void {
  const ids = set === 'dev' ? scenarios : listScenarioIds(set)
  const rows = ids.map((id) => {
    const actual = detectorConflicts(id, set)
    const expected = loadLabels(id, set).conflicts
    const score = scoreConflicts(actual, expected)
    return { id, actual, expected, score }
  })
  const overall = aggregateQuality(rows.map((row) => row.score))
  const json = {
    seed: 1701,
    scenarioSet: set,
    overall: {
      conflictLevel: overall.conflictLevel,
      ruleAttribution: overall.ruleAttribution,
      ruleAttributionAcceptable: overall.ruleAttributionAcceptable,
      rawRuleFirings: overall.rawRuleFirings,
    },
    scenarios: rows.map((row) => ({
      id: row.id,
      labels: row.expected,
      rawConflicts: row.actual,
      logicalConflicts: row.score.logicalConflicts.map(serializeLogicalConflict),
      matches: row.score.matches,
      score: {
        conflictLevel: conflictLevelScore(row.score),
        ruleAttribution: row.score.ruleAttribution,
        ruleAttributionAcceptable: row.score.ruleAttributionAcceptable,
        rawRuleFirings: row.score.rawRuleFirings,
      },
    })),
  }

  writeReport(
    reportName,
    json,
    `# Detector Quality (${set} set)

Conflict-level precision: ${overall.conflictLevel.precision.toFixed(2)}
Conflict-level recall: ${overall.conflictLevel.recall.toFixed(2)}
Conflict-level F1: ${overall.conflictLevel.f1.toFixed(2)}
Rule-attribution accuracy (strict, label rule only): ${overall.ruleAttribution.accuracy.toFixed(2)} (${overall.ruleAttribution.correct}/${overall.ruleAttribution.total})
Rule-attribution accuracy (accepting acceptableRules): ${overall.ruleAttributionAcceptable.accuracy.toFixed(2)} (${overall.ruleAttributionAcceptable.correct}/${overall.ruleAttributionAcceptable.total})

${table(['Scenario', 'Precision', 'Recall', 'F1', 'TP', 'FP', 'FN', 'Rule (strict)', 'Rule (acceptable)'], rows.map((row) => [row.id, row.score.precision.toFixed(2), row.score.recall.toFixed(2), row.score.f1.toFixed(2), row.score.truePositives, row.score.falsePositives, row.score.falseNegatives, `${row.score.ruleAttribution.correct}/${row.score.ruleAttribution.total}`, `${row.score.ruleAttributionAcceptable.correct}/${row.score.ruleAttributionAcceptable.total}`]))}

## Raw Rule-Firing Table

${table(['Rule', 'Expected', 'Actual', 'Matched'], Object.entries(overall.rawRuleFirings).map(([rule, value]) => [rule, value.expected, value.actual, value.matched]))}
`,
  )
}

function detectorConflicts(id: string, set: ScenarioSet): Conflict[] {
  const repo = loadFixtureRepo(loadScenario(id, set).fixture, `detector-${id}`)
  const before = SemanticIndex.build(repo)

  for (const agentId of ['agent-a', 'agent-b']) {
    applyScript(repo, loadAgentScript(id, agentId, set))
  }

  const after = SemanticIndex.build(repo)
  return new ImpactEngine().analyze(semanticDiff(before, after), after)
}

function loadLabels(id: string, set: ScenarioSet): LabelsFile {
  return loadLabelsFile<LabelsFile>(id, set)
}

function conflictLevelScore(score: QualityReport): Pick<QualityReport, 'precision' | 'recall' | 'f1' | 'truePositives' | 'falsePositives' | 'falseNegatives'> {
  return {
    precision: score.precision,
    recall: score.recall,
    f1: score.f1,
    truePositives: score.truePositives,
    falsePositives: score.falsePositives,
    falseNegatives: score.falseNegatives,
  }
}

function aggregateQuality(scores: QualityReport[]): {
  conflictLevel: Pick<QualityReport, 'precision' | 'recall' | 'f1' | 'truePositives' | 'falsePositives' | 'falseNegatives'>
  ruleAttribution: QualityReport['ruleAttribution']
  ruleAttributionAcceptable: QualityReport['ruleAttributionAcceptable']
  rawRuleFirings: QualityReport['rawRuleFirings']
} {
  const truePositives = scores.reduce((sum, score) => sum + score.truePositives, 0)
  const falsePositives = scores.reduce((sum, score) => sum + score.falsePositives, 0)
  const falseNegatives = scores.reduce((sum, score) => sum + score.falseNegatives, 0)
  const precision = truePositives + falsePositives === 0 ? 1 : truePositives / (truePositives + falsePositives)
  const recall = truePositives + falseNegatives === 0 ? 1 : truePositives / (truePositives + falseNegatives)
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall)
  const correct = scores.reduce((sum, score) => sum + score.ruleAttribution.correct, 0)
  const total = scores.reduce((sum, score) => sum + score.ruleAttribution.total, 0)
  const correctAcceptable = scores.reduce((sum, score) => sum + score.ruleAttributionAcceptable.correct, 0)
  const rawRuleFirings: QualityReport['rawRuleFirings'] = {}

  for (const score of scores) {
    for (const [rule, value] of Object.entries(score.rawRuleFirings)) {
      rawRuleFirings[rule] ??= { expected: 0, actual: 0, matched: 0 }
      rawRuleFirings[rule].expected += value.expected
      rawRuleFirings[rule].actual += value.actual
      rawRuleFirings[rule].matched += value.matched
    }
  }

  return {
    conflictLevel: {
      precision,
      recall,
      f1,
      truePositives,
      falsePositives,
      falseNegatives,
    },
    ruleAttribution: {
      correct,
      total,
      accuracy: total === 0 ? 1 : correct / total,
    },
    ruleAttributionAcceptable: {
      correct: correctAcceptable,
      total,
      accuracy: total === 0 ? 1 : correctAcceptable / total,
    },
    rawRuleFirings,
  }
}

function serializeLogicalConflict(logical: LogicalConflict): unknown {
  return {
    id: logical.id,
    primaryRule: logical.primaryRule,
    level: logical.level,
    severity: logical.severity,
    evidence: {
      files: [...logical.evidence.files].sort(),
      symbolTokens: [...logical.evidence.symbolTokens].sort(),
      bareSymbols: [...logical.evidence.bareSymbols].sort(),
      filePairs: [...logical.evidence.filePairs].sort(),
      rules: [...logical.evidence.rules].sort(),
    },
    conflicts: logical.conflicts,
  }
}

function writePropagationLatencyReport(): void {
  const json = propagationBench()
  const full = json.modes.fullRebuild.latencyMs
  const incremental = json.modes.incremental.latencyMs
  const comparison =
    incremental.p50 < full.p50
      ? `Incremental indexing is faster on this fixture by p50 (${incremental.p50.toFixed(2)} ms vs ${full.p50.toFixed(2)} ms).`
      : `Incremental indexing is not faster on this 6-file fixture by p50 (${incremental.p50.toFixed(2)} ms vs ${full.p50.toFixed(2)} ms).`
  writeReport(
    'propagation-latency',
    json,
    `# Propagation Latency

${table(['Mode', 'Files', 'Symbols', 'p50 ms', 'p95 ms', 'min ms', 'max ms'], [
  ['fullRebuild', json.files, json.symbols, full.p50.toFixed(2), full.p95.toFixed(2), full.min.toFixed(2), full.max.toFixed(2)],
  ['incremental', json.files, json.symbols, incremental.p50.toFixed(2), incremental.p95.toFixed(2), incremental.min.toFixed(2), incremental.max.toFixed(2)],
])}

${comparison}

This measures Repo.editFile through rebuild, diff, and event-level impact analysis. It does not include LLM inference latency.
`,
  )
}

async function writeGitPilotReport(): Promise<void> {
  const json = await gitPilot()
  writeReport(
    'git-pilot',
    json,
    `# Git Pilot

${table(['Scenario', 'Git textual conflicts', 'Git diagnostics', 'Hit early events', 'Hit final diagnostics', 'Hit repair actions'], json.scenarios.map((item) => [item.id, item.gitBaseline.textualMergeConflicts, item.gitBaseline.diagnosticsAfterIntegration, item.hit.earlyEvents, item.hit.finalDiagnostics, item.hit.repairActions]))}

This is a pilot comparison on scripted operations, not a wall-clock comparison of real LLM agents.
`,
  )
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2)

  if (argv[0] === 'detector') {
    // Detector-quality report only: `harness.ts detector [--set dev|heldout] [--out <report-name>]`.
    const option = (name: string): string | undefined => {
      const index = argv.indexOf(name)
      return index === -1 ? undefined : argv[index + 1]
    }
    const set = (option('--set') ?? 'dev') as ScenarioSet
    writeDetectorQualityReport(set, option('--out') ?? (set === 'dev' ? 'detector-quality' : `detector-quality-${set}`))
  } else {
    await runAnalyses()
  }
}

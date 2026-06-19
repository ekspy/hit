import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { ImpactEngine, scoreConflicts, type Conflict, type LabelsFile } from '@hit/impact-engine'
import { Repo } from '@hit/repo-crdt'
import { SemanticIndex, semanticDiff } from '@hit/semantic-indexer'

import { propagationBench } from './bench.js'
import { gitPilot } from './git-baseline.js'
import { table, writeReport } from './report.js'
import { applyScript, loadAgentScript, loadFixtureRepo, runScenario } from './scenario.js'

const scenarios = [
  '01-return-type-change',
  '02-symbol-rename',
  '03-removed-field',
  '04-symbol-move',
  '05-optional-to-required',
]

const here = path.dirname(fileURLToPath(import.meta.url))

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

function writeDetectorQualityReport(): void {
  const rows = scenarios.map((id) => {
    const actual = detectorConflicts(id)
    const expected = loadLabels(id).conflicts
    const score = scoreConflicts(actual, expected)
    return { id, actual, expected, score }
  })
  const allActual = rows.flatMap((row) => row.actual)
  const allExpected = rows.flatMap((row) => row.expected)
  const overall = scoreConflicts(allActual, allExpected)
  const json = {
    seed: 1701,
    overall,
    scenarios: rows.map((row) => ({
      id: row.id,
      score: row.score,
      conflicts: row.actual,
    })),
  }

  writeReport(
    'detector-quality',
    json,
    `# Detector Quality

Precision: ${overall.precision.toFixed(2)}
Recall: ${overall.recall.toFixed(2)}
F1: ${overall.f1.toFixed(2)}

${table(['Scenario', 'Precision', 'Recall', 'F1', 'TP', 'FP', 'FN'], rows.map((row) => [row.id, row.score.precision.toFixed(2), row.score.recall.toFixed(2), row.score.f1.toFixed(2), row.score.truePositives, row.score.falsePositives, row.score.falseNegatives]))}
`,
  )
}

function detectorConflicts(id: string): Conflict[] {
  const repo = loadFixtureRepo('shopapp', `detector-${id}`)
  const before = SemanticIndex.build(repo)

  for (const agentId of ['agent-a', 'agent-b']) {
    applyScript(repo, loadAgentScript(id, agentId))
  }

  const after = SemanticIndex.build(repo)
  return new ImpactEngine().analyze(semanticDiff(before, after), after)
}

function loadLabels(id: string): LabelsFile {
  return JSON.parse(readFileSync(path.resolve(here, '..', 'scenarios', id, 'labels.json'), 'utf8')) as LabelsFile
}

function writePropagationLatencyReport(): void {
  const json = propagationBench()
  writeReport(
    'propagation-latency',
    json,
    `# Propagation Latency

${table(['Files', 'Symbols', 'Full rebuild', 'p50 ms', 'p95 ms', 'min ms', 'max ms'], [[json.files, json.symbols, String(json.fullRebuild), json.latencyMs.p50.toFixed(2), json.latencyMs.p95.toFixed(2), json.latencyMs.min.toFixed(2), json.latencyMs.max.toFixed(2)]])}

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
  await runAnalyses()
}

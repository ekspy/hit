import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { reportsDir } from './paths.js'
import { table } from './report.js'
import type { Mode, RunResult } from './runs.js'

export interface Stats {
  n: number
  mean: number
  sd: number
  min: number
  max: number
}

export function stats(values: number[]): Stats {
  const n = values.length
  if (n === 0) {
    return { n: 0, mean: 0, sd: 0, min: 0, max: 0 }
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / n
  const variance = n > 1 ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1) : 0
  return { n, mean, sd: Math.sqrt(variance), min: Math.min(...values), max: Math.max(...values) }
}

const NUMERIC_METRICS = ['typecheckPass', 'testsPass', 'edits', 'turns', 'inputTokens', 'outputTokens', 'costUsd', 'wallClockMs', 'latencyP50Ms', 'eventsDelivered', 'actedAfterEvent', 'mergeConflicts'] as const
type MetricName = (typeof NUMERIC_METRICS)[number]

export interface GroupAggregate {
  model: string
  condition: string
  scenario: string
  runs: number
  errors: number
  metrics: Record<MetricName, Stats>
}

interface PairedSide {
  runs: number
  typecheckPass: number
  testsPass: number
  costUsd: number
  wallClockMs: number
  turns: number
}

export interface PairedRow {
  model: string
  scenario: string
  hit: PairedSide
  git: PairedSide
}

export interface Aggregate {
  mode: Mode
  generatedAt: string
  runs: number
  groups: GroupAggregate[]
  paired: PairedRow[]
  costByModel: Record<string, { runs: number; costUsd: number; inputTokens: number; outputTokens: number }>
  runIndex: Array<{ spec: RunResult['spec']; transcriptPath?: string; typecheckPass: boolean; testsPass: boolean; costUsd: number; error?: string }>
}

const SEP = '|'

export function runFilePath(mode: Mode, spec: RunResult['spec']): string {
  return path.join(reportsDir(), 'runs', mode, spec.model, spec.scenario, spec.condition, `${spec.rep}.json`)
}

export function writeRunTranscript(result: RunResult): string {
  const file = runFilePath(result.spec.mode, result.spec)
  mkdirSync(path.dirname(file), { recursive: true })
  result.transcriptPath = path.relative(reportsDir(), file)
  writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`)
  return file
}

export function loadRuns(mode: Mode): RunResult[] {
  const root = path.join(reportsDir(), 'runs', mode)
  if (!existsSync(root)) {
    return []
  }
  const files: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const file = path.join(dir, entry)
      if (statSync(file).isDirectory()) {
        walk(file)
      } else if (file.endsWith('.json')) {
        files.push(file)
      }
    }
  }
  walk(root)
  return files.sort().map((file) => JSON.parse(readFileSync(file, 'utf8')) as RunResult)
}

function metricValue(result: RunResult, metric: MetricName): number {
  const value = result.metrics[metric]
  return typeof value === 'boolean' ? (value ? 1 : 0) : value
}

export function aggregate(mode: Mode, runs: RunResult[]): Aggregate {
  const groups = new Map<string, RunResult[]>()
  for (const run of runs) {
    const key = [run.spec.model, run.spec.condition, run.spec.scenario].join(SEP)
    groups.set(key, [...(groups.get(key) ?? []), run])
  }

  const groupRows: GroupAggregate[] = [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, members]) => {
      const [model, condition, scenario] = key.split(SEP) as [string, string, string]
      const metrics = Object.fromEntries(NUMERIC_METRICS.map((metric) => [metric, stats(members.map((run) => metricValue(run, metric)))])) as Record<MetricName, Stats>
      return { model, condition, scenario, runs: members.length, errors: members.filter((run) => run.error).length, metrics }
    })

  const pairedKeys = [...new Set(runs.map((run) => [run.spec.model, run.spec.scenario].join(SEP)))].sort()
  const paired: PairedRow[] = pairedKeys.map((key) => {
    const [model, scenario] = key.split(SEP) as [string, string]
    const side = (condition: string): PairedSide => {
      const members = runs.filter((run) => run.spec.model === model && run.spec.scenario === scenario && run.spec.condition === condition)
      return {
        runs: members.length,
        typecheckPass: stats(members.map((run) => metricValue(run, 'typecheckPass'))).mean,
        testsPass: stats(members.map((run) => metricValue(run, 'testsPass'))).mean,
        costUsd: stats(members.map((run) => run.metrics.costUsd)).mean,
        wallClockMs: stats(members.map((run) => run.metrics.wallClockMs)).mean,
        turns: stats(members.map((run) => run.metrics.turns)).mean,
      }
    }
    return { model, scenario, hit: side('hit'), git: side('git') }
  })

  const costByModel: Aggregate['costByModel'] = {}
  for (const run of runs) {
    const entry = (costByModel[run.spec.model] ??= { runs: 0, costUsd: 0, inputTokens: 0, outputTokens: 0 })
    entry.runs += 1
    entry.costUsd += run.metrics.costUsd
    entry.inputTokens += run.metrics.inputTokens
    entry.outputTokens += run.metrics.outputTokens
  }

  return {
    mode,
    generatedAt: new Date().toISOString(),
    runs: runs.length,
    groups: groupRows,
    paired,
    costByModel,
    runIndex: runs.map((run) => ({
      spec: run.spec,
      transcriptPath: run.transcriptPath,
      typecheckPass: run.metrics.typecheckPass,
      testsPass: run.metrics.testsPass,
      costUsd: run.metrics.costUsd,
      error: run.error ? run.error.split('\n')[0] : undefined,
    })),
  }
}

const fmt = (value: number, digits = 2): string => value.toFixed(digits)
const pct = (value: number): string => `${(value * 100).toFixed(0)}%`
const range = (s: Stats, digits = 2, scale = 1): string => `${fmt(s.mean / scale, digits)} +- ${fmt(s.sd / scale, digits)} [${fmt(s.min / scale, digits)}, ${fmt(s.max / scale, digits)}]`

export function aggregateMarkdown(report: Aggregate): string {
  const title = report.mode === 'mode1' ? 'Mode 1 - scripted breaking change, LLM repair' : 'Mode 2 - two LLM agents on colliding tasks'
  const extraHeaders = report.mode === 'mode2' ? ['Events', 'Acted after event'] : []
  const extraCells = (group: GroupAggregate): string[] => (report.mode === 'mode2' ? [fmt(group.metrics.eventsDelivered.mean, 1), pct(group.metrics.actedAfterEvent.mean)] : [])

  return `# ${title}

Generated ${report.generatedAt} from ${report.runs} run(s) under \`reports/runs/${report.mode}/\`.
Values are mean +- sd [min, max] over repetitions; pass rates are the fraction of runs.

## Per (model, condition, scenario)

${table(
  ['Model', 'Condition', 'Scenario', 'Runs', 'Errors', 'Typecheck pass', 'Tests pass', 'Edits', 'Turns', 'Input tok', 'Output tok', 'Cost USD', 'Wall clock s', 'Latency p50 s', 'Merge conflicts', ...extraHeaders],
  report.groups.map((group) => [
    group.model,
    group.condition,
    group.scenario,
    group.runs,
    group.errors,
    pct(group.metrics.typecheckPass.mean),
    pct(group.metrics.testsPass.mean),
    range(group.metrics.edits, 1),
    range(group.metrics.turns, 1),
    range(group.metrics.inputTokens, 0),
    range(group.metrics.outputTokens, 0),
    range(group.metrics.costUsd, 4),
    range(group.metrics.wallClockMs, 1, 1000),
    range(group.metrics.latencyP50Ms, 1, 1000),
    fmt(group.metrics.mergeConflicts.mean, 1),
    ...extraCells(group),
  ]),
)}

## Paired hit vs git per scenario

${table(
  ['Model', 'Scenario', 'hit runs', 'git runs', 'Typecheck hit', 'Typecheck git', 'Tests hit', 'Tests git', 'Cost hit', 'Cost git', 'Wall hit s', 'Wall git s', 'Turns hit', 'Turns git'],
  report.paired.map((row) => [
    row.model,
    row.scenario,
    row.hit.runs,
    row.git.runs,
    pct(row.hit.typecheckPass),
    pct(row.git.typecheckPass),
    pct(row.hit.testsPass),
    pct(row.git.testsPass),
    fmt(row.hit.costUsd, 4),
    fmt(row.git.costUsd, 4),
    fmt(row.hit.wallClockMs / 1000, 1),
    fmt(row.git.wallClockMs / 1000, 1),
    fmt(row.hit.turns, 1),
    fmt(row.git.turns, 1),
  ]),
)}

## Cost per model

${table(
  ['Model', 'Runs', 'Input tokens', 'Output tokens', 'Cost USD'],
  Object.entries(report.costByModel).map(([model, entry]) => [model, entry.runs, entry.inputTokens, entry.outputTokens, fmt(entry.costUsd, 4)]),
)}
`
}

export function writeAggregate(mode: Mode): Aggregate {
  const report = aggregate(mode, loadRuns(mode))
  mkdirSync(reportsDir(), { recursive: true })
  writeFileSync(path.join(reportsDir(), `${mode}.json`), `${JSON.stringify(report, null, 2)}\n`)
  writeFileSync(path.join(reportsDir(), `${mode}.md`), aggregateMarkdown(report))
  return report
}

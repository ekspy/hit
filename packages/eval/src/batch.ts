import { readdirSync } from 'node:fs'

import { MODELS, createProvider, isModelId, modelUnavailableReason, type LlmCallLog, type ModelId } from '@hit/agent'
import { Command } from 'commander'

import { aggregateMarkdown, writeAggregate, writeRunTranscript } from './aggregate.js'
import { loadDotEnv } from './env.js'
import { tasksDir } from './paths.js'
import { executeRun, scenarioExists, type Condition, type Mode, type RunResult, type RunSpec } from './runs.js'

/** Mode 1 default set: the 12 breaking scenarios (01-09 + 14-16). Missing directories are skipped with a message. */
export const MODE1_SCENARIOS = [
  '01-return-type-change',
  '02-symbol-rename',
  '03-removed-field',
  '04-symbol-move',
  '05-optional-to-required',
  '06-widen-to-narrow-type',
  '07-async-contract-change',
  '08-import-path-change',
  '09-union-value-removed',
  '14-interface-field-rename',
  '15-enum-like-union-added-and-consumer-exhaustive',
  '16-two-producers-one-consumer',
]

export interface BatchOptions {
  mode: Mode
  models: ModelId[]
  scenarios: string[]
  conditions: Condition[]
  reps: number
  concurrency: number
  budgetUsd: number
  maxTurns: number
  aggregateOnly: boolean
  dryRun: boolean
}

export function parseBatchArgs(mode: Mode, argv: string[]): BatchOptions {
  const defaults = mode === 'mode1' ? { reps: 5, scenarios: MODE1_SCENARIOS } : { reps: 3, scenarios: listTaskPairs() }
  const program = new Command()
    .name(`eval:${mode}`)
    .option('--models <list>', 'comma-separated model ids', MODELS.join(','))
    .option('--scenarios <list>', mode === 'mode1' ? 'comma-separated scenario ids (prefix allowed, e.g. 01)' : 'comma-separated task pair ids (e.g. pair-01 or 01)', defaults.scenarios.join(','))
    .option('--conditions <list>', 'hit,git,hit-silent (hit-silent: mode2 ablation without events)', 'hit,git')
    .option('--reps <n>', 'repetitions per cell', String(defaults.reps))
    .option('--concurrency <n>', 'parallel runs', '4')
    .option('--budget <usd>', 'per-model budget guard in USD', '15')
    .option('--max-turns <n>', 'max model turns per session', '12')
    .option('--aggregate-only', 'only rebuild reports/<mode>.{json,md} from existing transcripts', false)
    .option('--dry-run', 'list the planned runs without calling any model', false)
  program.parse(argv, { from: 'user' })
  const raw = program.opts<{ models: string; scenarios: string; conditions: string; reps: string; concurrency: string; budget: string; maxTurns: string; aggregateOnly: boolean; dryRun: boolean }>()

  const models: ModelId[] = []
  for (const model of splitList(raw.models)) {
    if (!isModelId(model)) {
      throw new Error(`Unknown model ${model}; known: ${MODELS.join(', ')}`)
    }
    models.push(model)
  }
  const conditions = splitList(raw.conditions) as Condition[]
  for (const condition of conditions) {
    if (condition !== 'hit' && condition !== 'git' && condition !== 'hit-silent') {
      throw new Error(`Unknown condition ${condition}`)
    }
  }
  const scenarios = splitList(raw.scenarios).map((item) => resolveScenarioId(mode, item, defaults.scenarios))

  return {
    mode,
    models,
    scenarios,
    conditions,
    reps: Number(raw.reps),
    concurrency: Number(raw.concurrency),
    budgetUsd: Number(raw.budget),
    maxTurns: Number(raw.maxTurns),
    aggregateOnly: raw.aggregateOnly,
    dryRun: raw.dryRun,
  }
}

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function resolveScenarioId(mode: Mode, item: string, known: string[]): string {
  if (known.includes(item)) {
    return item
  }
  const match = known.find((id) => id.startsWith(`${item}-`))
  if (match) {
    return match
  }
  if (mode === 'mode2' && known.includes(`pair-${item}`)) {
    return `pair-${item}`
  }
  return item
}

export function listTaskPairs(): string[] {
  return readdirSync(tasksDir())
    .filter((file) => file.endsWith('.json'))
    .map((file) => file.replace(/\.json$/, ''))
    .sort()
}

export interface BatchSummary {
  completed: RunResult[]
  skipped: Array<{ spec: RunSpec; reason: string }>
  spendByModel: Record<string, number>
}

export async function runBatch(options: BatchOptions): Promise<BatchSummary> {
  loadDotEnv()
  const log = (line: string): void => console.log(`${new Date().toISOString().slice(11, 19)} ${line}`)

  if (options.aggregateOnly) {
    const report = writeAggregate(options.mode)
    console.log(aggregateMarkdown(report))
    return { completed: [], skipped: [], spendByModel: {} }
  }

  const availableModels: ModelId[] = []
  for (const model of options.models) {
    const reason = modelUnavailableReason(model)
    if (reason) {
      log(`skipping model ${model}: ${reason}`)
      continue
    }
    availableModels.push(model)
  }
  const scenarios = options.scenarios.filter((scenario) => {
    const exists = options.mode === 'mode1' ? scenarioExists(scenario) : listTaskPairs().includes(scenario)
    if (!exists) {
      log(`skipping ${options.mode === 'mode1' ? 'scenario' : 'task pair'} ${scenario}: not found`)
    }
    return exists
  })

  const specs: RunSpec[] = []
  // Interleaved order: repetition is the outer loop and the condition order rotates per (rep, scenario), so no
  // condition runs as one contiguous block and time-dependent provider effects spread across conditions.
  for (const model of availableModels) {
    for (let rep = 1; rep <= options.reps; rep += 1) {
      scenarios.forEach((scenario, index) => {
        const shift = (rep + index) % options.conditions.length
        for (const condition of [...options.conditions.slice(shift), ...options.conditions.slice(0, shift)]) {
          specs.push({ mode: options.mode, model, scenario, condition, rep })
        }
      })
    }
  }

  log(`${options.mode}: ${specs.length} run(s) planned; models [${availableModels.join(', ')}], scenarios [${scenarios.join(', ')}], conditions [${options.conditions.join(', ')}], reps ${options.reps}, concurrency ${options.concurrency}, budget $${options.budgetUsd}/model`)
  const skipped: BatchSummary['skipped'] = []
  if (options.dryRun || specs.length === 0) {
    for (const spec of specs) {
      log(`  ${describe(spec)}`)
    }
    return { completed: [], skipped, spendByModel: {} }
  }

  const providers = new Map(availableModels.map((model) => [model, createProvider(model)] as const))
  const spendByModel: Record<string, number> = Object.fromEntries(availableModels.map((model) => [model, 0]))
  for (const [model, provider] of providers) {
    provider.onCall((call: LlmCallLog) => {
      spendByModel[model] = (spendByModel[model] ?? 0) + call.costUsd
      log(
        `  llm ${model}: in ${call.usage.input} out ${call.usage.output} tokens, ${Math.round(call.latencyMs)} ms, $${call.costUsd.toFixed(4)}${call.attempts > 1 ? ` (attempt ${call.attempts})` : ''}${call.error ? ` ERROR ${call.error}` : ''} [cum $${spendByModel[model]!.toFixed(3)}]`,
      )
    })
  }

  const completed: RunResult[] = []
  const queue = [...specs]
  const worker = async (): Promise<void> => {
    for (;;) {
      const spec = queue.shift()
      if (!spec) {
        return
      }
      const spent = spendByModel[spec.model] ?? 0
      if (spent > options.budgetUsd) {
        skipped.push({ spec, reason: `budget guard: ${spec.model} spent $${spent.toFixed(2)} > $${options.budgetUsd}` })
        log(`skipping ${describe(spec)}: budget guard ($${spent.toFixed(2)} > $${options.budgetUsd})`)
        continue
      }
      log(`start ${describe(spec)}`)
      const result = await executeRun(spec, { provider: providers.get(spec.model)!, maxTurns: options.maxTurns, log })
      const file = writeRunTranscript(result)
      completed.push(result)
      const m = result.metrics
      log(
        `done  ${describe(spec)}: typecheck ${m.typecheckPass ? 'PASS' : 'FAIL'} (${m.diagnostics} diag), tests ${m.testsPass ? 'PASS' : 'FAIL'} (${m.testsPassed}/${m.testsPassed + m.testsFailed}), ${m.turns} turns, ${m.edits} edits, ${m.eventsDelivered} events, $${m.costUsd.toFixed(4)}, ${(m.wallClockMs / 1000).toFixed(1)} s${result.error ? `, ERROR: ${result.error.split('\n')[0]}` : ''} -> ${file}`,
      )
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, options.concurrency) }, () => worker()))

  const report = writeAggregate(options.mode)
  console.log()
  console.log(aggregateMarkdown(report))
  log(`spend this batch: ${Object.entries(spendByModel).map(([model, spend]) => `${model} $${spend.toFixed(4)}`).join(', ')}`)
  if (skipped.length > 0) {
    log(`${skipped.length} run(s) skipped`)
  }
  return { completed, skipped, spendByModel }
}

function describe(spec: RunSpec): string {
  return `${spec.model} ${spec.scenario} ${spec.condition} #${spec.rep}`
}

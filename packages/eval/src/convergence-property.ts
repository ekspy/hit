/**
 * Property-based convergence test of the CRDT repository (C40).
 *
 * Each generated case starts from a shared base (files and tasks created on
 * one replica and synchronised to all), then runs a random interleaving of
 * local operations on random replicas and partial pairwise synchronisations.
 * Operations include edits to the same file (biased towards the same region),
 * file creation (including the same path on different replicas), deletion,
 * renaming, concurrent task claims and releases.
 *
 * From the resulting (diverged) replicas, the final synchronisation is run
 * under several random orders, each on an independent copy (save/load), and
 * the property requires that (a) all replicas are equal after each order and
 * (b) the final state is the same whatever the order.
 */
import fc from 'fast-check'

import { Repo } from '@hit/repo-crdt'

import { writeReport, table } from './report.js'

type Step =
  | { kind: 'edit'; replica: number; file: number; region: number; offset: number; deleteCount: number; insert: string }
  | { kind: 'create'; replica: number; file: number; content: string }
  | { kind: 'delete'; replica: number; file: number }
  | { kind: 'rename'; replica: number; file: number; to: number }
  | { kind: 'claim'; replica: number; task: number }
  | { kind: 'release'; replica: number; task: number }
  | { kind: 'sync'; left: number; right: number }

export interface CaseInput {
  steps: Step[]
  /** Final synchronisation orders: each is a list of [left, right] pairs. */
  orders: Array<Array<[number, number]>>
}

export interface ConvergencePropertyOptions {
  seed: number
  numRuns: number
  replicas: number
  maxSteps: number
  finalOrders: number
}

export interface PropertyVerdict {
  /** Cases in which the property held. */
  passed: number
  failed: number
  /** Index (0-based) in the generated sequence of the first failing case, if any. */
  firstFailureIndex?: number
  firstFailureReason?: string
}

export interface ConvergencePropertyResult {
  replicas: number
  seed: number
  cases: number
  /**
   * State level: after each final order every replica has the same Automerge
   * heads and, materialised from scratch (save/load), the same files,
   * operation log and active claims; the result is the same for every order.
   */
  stateConvergence: PropertyVerdict
  /**
   * View level: the same comparison on the in-memory view each replica
   * exposes after incremental merges (what Hit's runtime reads).
   */
  viewConvergence: PropertyVerdict
  /** Minimal counterexample for the view-level property, found by fast-check shrinking. */
  viewCounterexample?: { shrinks: number; steps: unknown; orders: unknown; views: string[] }
  stepsPerCase: { min: number; median: number; max: number; mean: number; total: number }
  appliedOperationsPerCase: { min: number; median: number; max: number; mean: number; total: number }
  operationsByKind: Record<string, number>
  skippedOperations: number
  intermediateSyncs: number
  finalOrdersPerCase: number
  finalOrdersTested: number
  distinctFinalOrders: number
  possibleFinalOrders: number
  syncsPerFinalOrder: number
  concurrency: {
    casesWithConcurrentSameFileEdits: number
    concurrentSameRegionEditPairs: number
    casesWithConcurrentSameRegionEdits: number
    concurrentSamePathCreates: number
    casesWithConcurrentSamePathCreates: number
    casesWithConcurrentClaimsOnSameTask: number
    casesWithEditDeleteRace: number
  }
}

const baseFiles = ['src/a.ts', 'src/b.ts']
const extraFiles = ['src/c.ts', 'src/d.ts', 'src/e.ts']
const filePool = [...baseFiles, ...extraFiles]
const baseContent = 'export const value = 1\nexport function f(x: number): number {\n  return x + 1\n}\n'
const taskCount = 2
const regionCount = 3

function stepArbitrary(replicas: number): fc.Arbitrary<Step> {
  const replica = fc.integer({ min: 0, max: replicas - 1 })
  const file = fc.integer({ min: 0, max: filePool.length - 1 })
  const text = fc.stringOf(fc.constantFrom('a', 'b', 'x', ' ', '\n', '1', '{', '}', ';', 'é'), { maxLength: 6 })

  return fc.oneof(
    // Edits dominate, restricted to the two base files most of the time so
    // that replicas edit the same file and, often, the same region.
    {
      weight: 6,
      arbitrary: fc.record({
        kind: fc.constant('edit' as const),
        replica,
        file: fc.oneof({ weight: 4, arbitrary: fc.integer({ min: 0, max: baseFiles.length - 1 }) }, { weight: 1, arbitrary: file }),
        region: fc.integer({ min: 0, max: regionCount - 1 }),
        offset: fc.integer({ min: 0, max: 3 }),
        deleteCount: fc.integer({ min: 0, max: 4 }),
        insert: text,
      }),
    },
    { weight: 2, arbitrary: fc.record({ kind: fc.constant('create' as const), replica, file, content: text }) },
    { weight: 1, arbitrary: fc.record({ kind: fc.constant('delete' as const), replica, file }) },
    { weight: 1, arbitrary: fc.record({ kind: fc.constant('rename' as const), replica, file, to: file }) },
    { weight: 2, arbitrary: fc.record({ kind: fc.constant('claim' as const), replica, task: fc.integer({ min: 0, max: taskCount - 1 }) }) },
    { weight: 1, arbitrary: fc.record({ kind: fc.constant('release' as const), replica, task: fc.integer({ min: 0, max: taskCount - 1 }) }) },
    {
      weight: 2,
      arbitrary: fc
        .tuple(replica, replica)
        .filter(([left, right]) => left !== right)
        .map(([left, right]) => ({ kind: 'sync' as const, left, right })),
    },
  )
}

function allPairs(replicas: number): Array<[number, number]> {
  const pairs: Array<[number, number]> = []
  for (let left = 0; left < replicas; left += 1) {
    for (let right = left + 1; right < replicas; right += 1) {
      pairs.push([left, right])
    }
  }
  return pairs
}

/**
 * A final order is a random permutation of all unordered replica pairs, each
 * with a random direction, repeated for two rounds (the second permutation is
 * independent of the first).
 */
function orderArbitrary(replicas: number): fc.Arbitrary<Array<[number, number]>> {
  const pairs = allPairs(replicas)
  const round = fc
    .tuple(fc.shuffledSubarray(pairs, { minLength: pairs.length, maxLength: pairs.length }), fc.array(fc.boolean(), { minLength: pairs.length, maxLength: pairs.length }))
    .map(([shuffled, flips]) => shuffled.map(([left, right], index) => (flips[index] ? [right, left] : [left, right]) as [number, number]))
  return fc.tuple(round, round).map(([first, second]) => [...first, ...second])
}

export function caseArbitrary(options: ConvergencePropertyOptions): fc.Arbitrary<CaseInput> {
  return fc.record({
    steps: fc.array(stepArbitrary(options.replicas), { minLength: 10, maxLength: options.maxSteps, size: 'max' }),
    orders: fc.array(orderArbitrary(options.replicas), { minLength: options.finalOrders, maxLength: options.finalOrders }),
  })
}

interface Replica {
  repo: Repo
  claims: Map<number, string[]>
}

function actorId(index: number): string {
  return `agent-${String.fromCharCode(97 + index)}`
}

function setup(replicas: number): { replicas: Replica[]; taskIds: string[] } {
  const repos = Array.from({ length: replicas }, (_, index) => Repo.create(actorId(index)))
  const origin = repos[0]!

  for (const file of baseFiles) {
    origin.createFile(file, baseContent, 'ts')
  }

  const taskIds = Array.from({ length: taskCount }, (_, index) => origin.createTask({ title: `Task ${index}`, description: 'Shared task' }))

  for (let index = 1; index < repos.length; index += 1) {
    origin.syncWith(repos[index]!)
  }

  return { replicas: repos.map((repo) => ({ repo, claims: new Map() })), taskIds }
}

export interface CaseStats {
  applied: number
  skipped: number
  syncs: number
  byKind: Record<string, number>
  sameFileEdits: boolean
  sameRegionPairs: number
  samePathCreates: number
  concurrentClaims: boolean
  editDeleteRace: boolean
}

/**
 * Applies the steps and tracks concurrency: an operation is concurrent with
 * another if neither replica has synchronised with the other in between
 * (tracked with a per-replica "knows" vector of operation indices).
 */
function applySteps(state: { replicas: Replica[]; taskIds: string[] }, steps: Step[]): CaseStats {
  const stats: CaseStats = {
    applied: 0,
    skipped: 0,
    syncs: 0,
    byKind: {},
    sameFileEdits: false,
    sameRegionPairs: 0,
    samePathCreates: 0,
    concurrentClaims: false,
    editDeleteRace: false,
  }
  // Applied operations with the set of replicas that have seen them.
  const history: Array<{ replica: number; kind: string; file?: string; task?: number; start?: number; end?: number; seenBy: Set<number> }> = []
  const concurrentWith = (replica: number) => history.filter((entry) => entry.replica !== replica && !entry.seenBy.has(replica))

  for (const step of steps) {
    if (step.kind === 'sync') {
      const { left, right } = step
      state.replicas[left]!.repo.syncWith(state.replicas[right]!.repo)
      for (const entry of history) {
        if (entry.seenBy.has(left) || entry.seenBy.has(right)) {
          entry.seenBy.add(left)
          entry.seenBy.add(right)
        }
      }
      stats.syncs += 1
      continue
    }

    const replica = state.replicas[step.replica]!
    const repo = replica.repo
    const visible = new Set(repo.listFiles())
    const path = 'file' in step ? filePool[step.file]! : ''
    let record: (typeof history)[number] | undefined

    if (step.kind === 'edit') {
      if (!visible.has(path)) {
        stats.skipped += 1
        continue
      }
      const content = repo.fileContent(path)
      const regionStart = Math.floor((content.length * step.region) / regionCount)
      const start = Math.min(content.length, regionStart + step.offset)
      const deleteCount = Math.min(step.deleteCount, content.length - start)
      repo.editFile(path, { start, deleteCount, insert: step.insert })
      record = { replica: step.replica, kind: 'edit', file: path, start: regionStart, end: regionStart + Math.ceil(content.length / regionCount), seenBy: new Set([step.replica]) }
      const others = concurrentWith(step.replica).filter((entry) => entry.kind === 'edit' && entry.file === path)
      if (others.length > 0) stats.sameFileEdits = true
      stats.sameRegionPairs += others.filter((entry) => entry.start === record!.start).length
      if (concurrentWith(step.replica).some((entry) => entry.kind === 'delete' && entry.file === path)) stats.editDeleteRace = true
    } else if (step.kind === 'create') {
      if (visible.has(path)) {
        stats.skipped += 1
        continue
      }
      repo.createFile(path, `export const created = '${step.content.replace(/['\\\n]/g, '')}'\n`, 'ts')
      record = { replica: step.replica, kind: 'create', file: path, seenBy: new Set([step.replica]) }
      stats.samePathCreates += concurrentWith(step.replica).filter((entry) => entry.kind === 'create' && entry.file === path).length
    } else if (step.kind === 'delete') {
      if (!visible.has(path)) {
        stats.skipped += 1
        continue
      }
      repo.deleteFile(path)
      record = { replica: step.replica, kind: 'delete', file: path, seenBy: new Set([step.replica]) }
      if (concurrentWith(step.replica).some((entry) => entry.kind === 'edit' && entry.file === path)) stats.editDeleteRace = true
    } else if (step.kind === 'rename') {
      const target = filePool[step.to]!
      if (!visible.has(path) || visible.has(target) || target === path) {
        stats.skipped += 1
        continue
      }
      repo.renameFile(path, target)
      record = { replica: step.replica, kind: 'rename', file: path, seenBy: new Set([step.replica]) }
    } else if (step.kind === 'claim') {
      const proposal = repo.claimTask(state.taskIds[step.task]!)
      replica.claims.set(step.task, [...(replica.claims.get(step.task) ?? []), proposal])
      record = { replica: step.replica, kind: 'claim', task: step.task, seenBy: new Set([step.replica]) }
      if (concurrentWith(step.replica).some((entry) => entry.kind === 'claim' && entry.task === step.task)) stats.concurrentClaims = true
    } else {
      const proposals = replica.claims.get(step.task) ?? []
      const proposal = proposals.shift()
      if (!proposal) {
        stats.skipped += 1
        continue
      }
      repo.releaseClaim(state.taskIds[step.task]!, proposal)
      record = { replica: step.replica, kind: 'release', task: step.task, seenBy: new Set([step.replica]) }
    }

    history.push(record)
    stats.applied += 1
    stats.byKind[step.kind] = (stats.byKind[step.kind] ?? 0) + 1
  }

  return stats
}

/** JSON with object keys sorted, so that equal states compare equal regardless of key insertion order. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)))
      : item,
  )
}

function snapshot(repo: Repo, taskIds: string[]): string {
  return canonical({
    files: repo.listFiles().map((path) => [path, repo.fileContent(path), repo.fileLang(path)]),
    operations: repo.getOperationLog(),
    claims: taskIds.map((taskId) => repo.activeClaim(taskId) ?? null),
    heads: [...repo.getHeads()].sort(),
  })
}

function summary(values: number[]): { min: number; median: number; max: number; mean: number; total: number } {
  const sorted = [...values].sort((left, right) => left - right)
  const total = sorted.reduce((sum, value) => sum + value, 0)
  return {
    min: sorted[0] ?? 0,
    median: sorted.length === 0 ? 0 : sorted.length % 2 === 1 ? sorted[(sorted.length - 1) / 2]! : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2,
    max: sorted.at(-1) ?? 0,
    mean: sorted.length === 0 ? 0 : total / sorted.length,
    total,
  }
}

export interface CaseOutcome {
  stats: CaseStats
  state: { ok: boolean; reason?: string }
  view: { ok: boolean; reason?: string; views: string[] }
}

function verdict(perOrder: string[][]): { ok: boolean; reason?: string } {
  for (const current of perOrder) {
    if (!current.every((item) => item === current[0])) {
      return { ok: false, reason: 'replicas differ after an order' }
    }
  }

  if (!perOrder.every((current) => current[0] === perOrder[0]![0])) {
    return { ok: false, reason: 'orders disagree' }
  }

  return { ok: true }
}

export function evaluateCase(replicaCount: number, input: CaseInput): CaseOutcome {
  const state = setup(replicaCount)
  const stats = applySteps(state, input.steps)
  const saved = state.replicas.map((replica) => replica.repo.save())
  const views: string[][] = []
  const materialised: string[][] = []

  for (const order of input.orders) {
    const copies = saved.map((bytes, index) => Repo.load(actorId(index), bytes))
    for (const [left, right] of order) {
      copies[left]!.syncWith(copies[right]!)
    }
    views.push(copies.map((repo) => snapshot(repo, state.taskIds)))
    materialised.push(copies.map((repo, index) => snapshot(Repo.load(actorId(index), repo.save()), state.taskIds)))
  }

  const view = verdict(views)
  return { stats, state: verdict(materialised), view: { ...view, views: view.ok ? [] : views.flat() } }
}

async function releaseMemory(index: number): Promise<void> {
  // Automerge documents live in WASM memory and are released by finalizers,
  // which only run when the event loop gets a turn after a collection; a
  // synchronous loop exhausts the WASM heap on long runs.
  if (index % 5 !== 0) return
  ;(globalThis as { gc?: () => void }).gc?.()
  await new Promise((resolve) => setImmediate(resolve))
}

function possibleOrders(replicas: number): number {
  const pairs = allPairs(replicas).length
  let factorial = 1
  for (let value = 2; value <= pairs; value += 1) factorial *= value
  const round = factorial * 2 ** pairs
  return round * round
}

export async function runConvergenceProperty(options: ConvergencePropertyOptions): Promise<ConvergencePropertyResult> {
  const inputs = fc.sample(caseArbitrary(options), { seed: options.seed, numRuns: options.numRuns })
  const steps: number[] = []
  const applied: number[] = []
  const byKind: Record<string, number> = {}
  const orders = new Set<string>()
  const state: PropertyVerdict = { passed: 0, failed: 0 }
  const view: PropertyVerdict = { passed: 0, failed: 0 }
  let skipped = 0
  let syncs = 0
  let finalOrdersTested = 0
  let sameFileCases = 0
  let sameRegionPairs = 0
  let sameRegionCases = 0
  let samePathCreates = 0
  let samePathCases = 0
  let claimCases = 0
  let raceCases = 0

  for (const [index, input] of inputs.entries()) {
    await releaseMemory(index)
    const outcome = evaluateCase(options.replicas, input)
    const { stats } = outcome

    for (const [target, result] of [[state, outcome.state], [view, outcome.view]] as const) {
      if (result.ok) {
        target.passed += 1
      } else {
        target.failed += 1
        target.firstFailureIndex ??= index
        target.firstFailureReason ??= result.reason
      }
    }

    steps.push(input.steps.length)
    applied.push(stats.applied)
    skipped += stats.skipped
    syncs += stats.syncs
    for (const [kind, count] of Object.entries(stats.byKind)) byKind[kind] = (byKind[kind] ?? 0) + count
    for (const order of input.orders) orders.add(JSON.stringify(order))
    finalOrdersTested += input.orders.length
    if (stats.sameFileEdits) sameFileCases += 1
    sameRegionPairs += stats.sameRegionPairs
    if (stats.sameRegionPairs > 0) sameRegionCases += 1
    samePathCreates += stats.samePathCreates
    if (stats.samePathCreates > 0) samePathCases += 1
    if (stats.concurrentClaims) claimCases += 1
    if (stats.editDeleteRace) raceCases += 1
  }

  let viewCounterexample: ConvergencePropertyResult['viewCounterexample']

  if (view.failed > 0) {
    // Shrink from the first failing case to a minimal counterexample.
    let calls = 0
    const details = await fc.check(
      fc.asyncProperty(caseArbitrary(options), async (input) => {
        await releaseMemory((calls += 1))
        return evaluateCase(options.replicas, input).view.ok
      }),
      { seed: options.seed, numRuns: options.numRuns },
    )
    const minimal = details.counterexample?.[0]
    if (minimal) {
      viewCounterexample = { shrinks: details.numShrinks, steps: minimal.steps, orders: minimal.orders, views: evaluateCase(options.replicas, minimal).view.views }
    }
  }

  return {
    replicas: options.replicas,
    seed: options.seed,
    cases: inputs.length,
    stateConvergence: state,
    viewConvergence: view,
    ...(viewCounterexample ? { viewCounterexample } : {}),
    stepsPerCase: summary(steps),
    appliedOperationsPerCase: summary(applied),
    operationsByKind: byKind,
    skippedOperations: skipped,
    intermediateSyncs: syncs,
    finalOrdersPerCase: options.finalOrders,
    finalOrdersTested,
    distinctFinalOrders: orders.size,
    possibleFinalOrders: possibleOrders(options.replicas),
    syncsPerFinalOrder: allPairs(options.replicas).length * 2,
    concurrency: {
      casesWithConcurrentSameFileEdits: sameFileCases,
      concurrentSameRegionEditPairs: sameRegionPairs,
      casesWithConcurrentSameRegionEdits: sameRegionCases,
      concurrentSamePathCreates: samePathCreates,
      casesWithConcurrentSamePathCreates: samePathCases,
      casesWithConcurrentClaimsOnSameTask: claimCases,
      casesWithEditDeleteRace: raceCases,
    },
  }
}

export async function writeConvergencePropertyReport(seed = 1701, numRuns = 500): Promise<void> {
  const config = { seed, numRuns, maxSteps: 40, finalOrders: 3 }
  const started = performance.now()
  const cases: ConvergencePropertyResult[] = []
  for (const replicas of [2, 3]) {
    cases.push(await runConvergenceProperty({ ...config, replicas }))
  }
  const elapsedMs = performance.now() - started
  const json = {
    library: 'fast-check 3.22.0 (fc.sample for the case sequence, fc.check for shrinking)',
    automerge: '@automerge/automerge 2.2.9',
    config: { ...config, replicas: [2, 3], baseFiles, filePool, tasks: taskCount, regionsPerFile: regionCount },
    elapsedMs,
    compared: 'visible files with content and language, operation log, active claim per task, Automerge heads',
    cases,
  }
  writeReport(
    'convergence-property',
    json,
    `# Convergence (property-based)

Seed ${seed}; ${numRuns} generated cases per replica count; 10 to ${config.maxSteps} steps per case (local operations on random replicas interleaved with random pairwise syncs);
${config.finalOrders} random final synchronisation orders per case (two rounds, each a random permutation of all replica pairs with random direction), each applied to an independent copy of the diverged replicas.

State level: equal Automerge heads and equal state when materialised from scratch (save/load). View level: equal in-memory view after incremental merges (what the runtime reads).

${table(
  ['Replicas', 'Cases', 'State-level pass/fail', 'View-level pass/fail', 'First view failure (case index)', 'Steps/case (min/med/max)', 'Applied ops/case (min/med/max)', 'Applied ops total', 'Intermediate syncs', 'Final orders tested', 'Distinct final orders (possible)'],
  cases.map((item) => [
    item.replicas,
    item.cases,
    `${item.stateConvergence.passed}/${item.stateConvergence.failed}`,
    `${item.viewConvergence.passed}/${item.viewConvergence.failed}`,
    item.viewConvergence.firstFailureIndex ?? '-',
    `${item.stepsPerCase.min}/${item.stepsPerCase.median}/${item.stepsPerCase.max}`,
    `${item.appliedOperationsPerCase.min}/${item.appliedOperationsPerCase.median}/${item.appliedOperationsPerCase.max}`,
    item.appliedOperationsPerCase.total,
    item.intermediateSyncs,
    item.finalOrdersTested,
    `${item.distinctFinalOrders} (${item.possibleFinalOrders})`,
  ]),
)}

${table(
  ['Replicas', 'Cases w/ concurrent same-file edits', 'Concurrent same-region edit pairs', 'Cases w/ same-region edits', 'Concurrent same-path creates', 'Cases w/ same-path creates', 'Cases w/ concurrent claims (same task)', 'Cases w/ edit/delete race'],
  cases.map((item) => [
    item.replicas,
    item.concurrency.casesWithConcurrentSameFileEdits,
    item.concurrency.concurrentSameRegionEditPairs,
    item.concurrency.casesWithConcurrentSameRegionEdits,
    item.concurrency.concurrentSamePathCreates,
    item.concurrency.casesWithConcurrentSamePathCreates,
    item.concurrency.casesWithConcurrentClaimsOnSameTask,
    item.concurrency.casesWithEditDeleteRace,
  ]),
)}

Operations by kind: ${cases.map((item) => `${item.replicas} replicas: ${JSON.stringify(item.operationsByKind)}`).join('; ')}

${cases
  .filter((item) => item.viewCounterexample)
  .map((item) => `Minimal view-level counterexample (${item.replicas} replicas, ${item.viewCounterexample!.shrinks} shrinks): steps ${JSON.stringify(item.viewCounterexample!.steps)}; orders ${JSON.stringify(item.viewCounterexample!.orders)}`)
  .join('\n\n')}
`,
  )
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2)
  const option = (name: string): string | undefined => {
    const index = argv.indexOf(name)
    return index === -1 ? undefined : argv[index + 1]
  }
  await writeConvergencePropertyReport(Number(option('--seed') ?? 1701), Number(option('--runs') ?? 500))
}

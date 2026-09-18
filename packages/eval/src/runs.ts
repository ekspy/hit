import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { LlmAgent, RepoWorkspace, formatDiagnostics, type LlmCallLog, type LoggingProvider, type ModelId, type SessionResult } from '@hit/agent'
import { MultiReplicaRuntime, type SemanticEvent } from '@hit/coordinator'
import type { LabelsFile } from '@hit/impact-engine'
import { Repo } from '@hit/repo-crdt'

import { runFixtureTests, typecheckRepo } from './fs-repo.js'
import { GitPair } from './git-worktree.js'
import { percentiles } from './metrics.js'
import { scenarioDir, tasksDir } from './paths.js'
import { applyScript, loadAgentScript, loadFixtureRepo, loadScenario } from './scenario.js'

export type Mode = 'mode1' | 'mode2'
export type Condition = 'hit' | 'git'

export interface RunSpec {
  mode: Mode
  model: ModelId
  /** Scenario id (Mode 1) or task pair id (Mode 2). */
  scenario: string
  condition: Condition
  rep: number
}

export interface RunMetrics {
  typecheckPass: boolean
  diagnostics: number
  testsPass: boolean
  testsPassed: number
  testsFailed: number
  edits: number
  turns: number
  inputTokens: number
  outputTokens: number
  costUsd: number
  wallClockMs: number
  latencyP50Ms: number
  llmCalls: number
  eventsDelivered: number
  actedAfterEvent: boolean
  mergeConflicts: number
  converged: boolean
}

export interface RunResult {
  spec: RunSpec
  startedAt: string
  finishedAt: string
  metrics: RunMetrics
  error?: string
  mergeNote?: string
  eventsDelivered: Array<{ memberId: string; events: SemanticEvent[] }>
  finalDiagnostics: string[]
  testOutput: string
  agents: Array<{ id: string; ownFiles: string[]; sessions: SessionResult[] }>
  calls: LlmCallLog[]
  transcriptPath?: string
}

export interface TaskPair {
  id: string
  title: string
  fixture: string
  derivedFrom: string
  maxTurns?: number
  agents: Array<{ id: string; ownFiles: string[]; task: string }>
}

export interface RunOptions {
  provider: LoggingProvider
  maxTurns: number
  log: (line: string) => void
}

export function loadTaskPair(id: string): TaskPair {
  return JSON.parse(readFileSync(path.join(tasksDir(), `${id}.json`), 'utf8')) as TaskPair
}

export function scenarioExists(id: string): boolean {
  return existsSync(path.join(scenarioDir(id), 'scenario.json'))
}

function loadLabels(id: string): LabelsFile {
  return JSON.parse(readFileSync(path.join(scenarioDir(id), 'labels.json'), 'utf8')) as LabelsFile
}

/** Files agent A's script touches (the producer side). Agent B owns everything else. */
function producerFiles(scenarioId: string): string[] {
  const fromScript = loadAgentScript(scenarioId, 'agent-a').operations.flatMap((operation) => ('path' in operation ? [operation.path] : []))
  const fromLabels = loadLabels(scenarioId).conflicts.map((conflict) => conflict.origin.file)
  return [...new Set([...fromScript, ...fromLabels])].sort()
}

export async function executeRun(spec: RunSpec, options: RunOptions): Promise<RunResult> {
  const startedAt = new Date().toISOString()
  const started = performance.now()
  const callsBefore = options.provider.logs.length
  const parentLog = options.log
  options = { ...options, log: (line) => parentLog(`[${spec.scenario} ${spec.condition} #${spec.rep}] ${line}`) }
  let partial: PartialLike = { agents: [] }
  let error: string | undefined

  try {
    partial = spec.mode === 'mode1' ? await (spec.condition === 'hit' ? mode1Hit(spec, options) : mode1Git(spec, options)) : await (spec.condition === 'hit' ? mode2Hit(spec, options) : mode2Git(spec, options))
  } catch (caught) {
    error = caught instanceof Error ? (caught.stack ?? caught.message) : String(caught)
  }

  const calls = options.provider.logs.slice(callsBefore)
  const sessions = partial.agents.flatMap((agent) => agent.sessions)
  const latencies = sessions.flatMap((session) => session.latenciesMs)
  const metrics: RunMetrics = {
    typecheckPass: partial.metrics?.typecheckPass ?? false,
    diagnostics: partial.metrics?.diagnostics ?? -1,
    testsPass: partial.metrics?.testsPass ?? false,
    testsPassed: partial.metrics?.testsPassed ?? 0,
    testsFailed: partial.metrics?.testsFailed ?? 0,
    edits: sessions.reduce((sum, session) => sum + session.edits, 0),
    turns: sessions.reduce((sum, session) => sum + session.turns, 0),
    inputTokens: sessions.reduce((sum, session) => sum + session.usage.input, 0),
    outputTokens: sessions.reduce((sum, session) => sum + session.usage.output, 0),
    costUsd: sessions.reduce((sum, session) => sum + session.costUsd, 0),
    wallClockMs: performance.now() - started,
    latencyP50Ms: percentiles(latencies).p50,
    llmCalls: calls.length,
    eventsDelivered: (partial.eventsDelivered ?? []).reduce((sum, delivery) => sum + delivery.events.length, 0),
    actedAfterEvent: sessions.some(actedAfterEvent),
    mergeConflicts: partial.metrics?.mergeConflicts ?? 0,
    converged: partial.metrics?.converged ?? true,
  }

  return {
    spec,
    startedAt,
    finishedAt: new Date().toISOString(),
    metrics,
    error: error ?? partial.error ?? sessions.find((session) => session.error)?.error,
    mergeNote: partial.mergeNote,
    eventsDelivered: partial.eventsDelivered ?? [],
    finalDiagnostics: partial.finalDiagnostics ?? [],
    testOutput: partial.testOutput ?? '',
    agents: partial.agents,
    calls,
  }
}

/** True when a session had an injected event followed (same or later turn) by a successful edit. */
export function actedAfterEvent(session: SessionResult): boolean {
  let seenEvent = false
  for (const record of session.turnRecords) {
    if (record.injectedEvents && record.injectedEvents.length > 0) {
      seenEvent = true
    }
    if (seenEvent && record.toolCalls.some((call) => call.name === 'edit_file' && !call.isError)) {
      return true
    }
  }
  return false
}

type PartialResult = Omit<RunResult, 'spec' | 'startedAt' | 'finishedAt' | 'calls' | 'metrics' | 'transcriptPath'> & {
  metrics: Pick<RunMetrics, 'typecheckPass' | 'diagnostics' | 'testsPass' | 'testsPassed' | 'testsFailed' | 'mergeConflicts' | 'converged'>
}
type PartialLike = Omit<globalThis.Partial<PartialResult>, 'agents'> & { agents: RunResult['agents'] }

async function finalChecks(repo: Repo, fixture: string, extra: { mergeConflicts?: number; converged?: boolean } = {}): Promise<Pick<PartialResult, 'metrics' | 'finalDiagnostics' | 'testOutput'>> {
  const diagnostics = typecheckRepo(repo)
  const tests = await runFixtureTests(repo, fixture)
  return {
    metrics: {
      typecheckPass: diagnostics.length === 0,
      diagnostics: diagnostics.length,
      testsPass: tests.ok,
      testsPassed: tests.passed,
      testsFailed: tests.failed,
      mergeConflicts: extra.mergeConflicts ?? 0,
      converged: extra.converged ?? true,
    },
    finalDiagnostics: formatDiagnostics(diagnostics).split('\n').slice(1),
    testOutput: tests.output,
  }
}

function fork(seed: Repo, actorId: string): Repo {
  return Repo.load(actorId, seed.save())
}

// ---- Mode 1 ---------------------------------------------------------------------------------

async function mode1Hit(spec: RunSpec, options: RunOptions): Promise<PartialResult> {
  const scenario = loadScenario(spec.scenario)
  const seed = loadFixtureRepo(scenario.fixture, 'seed')
  const repoA = fork(seed, 'agent-a')
  const repoB = fork(seed, 'agent-b')
  const producers = producerFiles(spec.scenario)
  const ownFiles = seed.listFiles().filter((file) => !producers.includes(file))
  const agentB = new LlmAgent({ id: 'agent-b', provider: options.provider, workspace: new RepoWorkspace(repoB), ownFiles, readOnlyFiles: producers, maxTurns: options.maxTurns, log: options.log })
  // B's own (usually no-op) script is applied before the runtime observes B, so B is never told about its own edits.
  applyScript(repoB, loadAgentScript(spec.scenario, 'agent-b'))
  const runtime = new MultiReplicaRuntime([
    { id: 'agent-a', repo: repoA },
    { id: 'agent-b', repo: repoB, agent: agentB },
  ])
  applyScript(repoA, loadAgentScript(spec.scenario, 'agent-a'))
  // One step: replicas sync, B observes the incoming change on its own replica, events are delivered, B repairs, replicas sync again.
  await runtime.step()

  const checks = await finalChecks(repoB, scenario.fixture, { converged: runtime.converged() })
  return { ...checks, eventsDelivered: runtime.eventsDelivered, agents: [{ id: 'agent-b', ownFiles, sessions: agentB.sessions }] }
}

async function mode1Git(spec: RunSpec, options: RunOptions): Promise<PartialResult> {
  const scenario = loadScenario(spec.scenario)
  const pair = await GitPair.create(scenario.fixture)
  try {
    for (const agentId of ['agent-a', 'agent-b']) {
      const repo = pair.loadRepo(agentId)
      applyScript(repo, loadAgentScript(spec.scenario, agentId))
      pair.writeRepo(agentId, repo)
      await pair.commit(agentId, `${agentId}: ${spec.scenario}`)
    }

    const merge = await pair.merge()
    const merged = pair.loadRepo(pair.mergedTarget(), 'agent-b')
    const producers = producerFiles(spec.scenario)
    const ownFiles = merged.listFiles().filter((file) => !producers.includes(file))
    const agentB = new LlmAgent({ id: 'agent-b', provider: options.provider, workspace: new RepoWorkspace(merged), ownFiles, readOnlyFiles: producers, maxTurns: options.maxTurns, log: options.log })
    const diagnostics = typecheckRepo(merged)

    if (diagnostics.length > 0 || !merge.ok) {
      await agentB.runLateRepair(formatDiagnostics(diagnostics), merge.ok ? '' : `Git reported textual conflicts in: ${merge.conflictedFiles.join(', ')} (conflict markers are still in the files).`)
      pair.writeRepo(pair.mergedTarget(), merged)
      await pair.commit(pair.mergedTarget(), 'agent-b: post-merge repair')
    }

    const checks = await finalChecks(merged, scenario.fixture, { mergeConflicts: merge.conflictedFiles.length })
    return { ...checks, mergeNote: merge.message, eventsDelivered: [], agents: [{ id: 'agent-b', ownFiles, sessions: agentB.sessions }] }
  } finally {
    await pair.cleanup()
  }
}

// ---- Mode 2 ---------------------------------------------------------------------------------

function otherFiles(pair: TaskPair, agentId: string): string[] {
  return pair.agents.filter((agent) => agent.id !== agentId).flatMap((agent) => agent.ownFiles)
}

async function mode2Hit(spec: RunSpec, options: RunOptions): Promise<PartialResult> {
  const pair = loadTaskPair(spec.scenario)
  const seed = loadFixtureRepo(pair.fixture, 'seed')
  const maxTurns = pair.maxTurns ?? options.maxTurns
  const members = pair.agents.map((definition) => {
    const repo = fork(seed, definition.id)
    const agent = new LlmAgent({ id: definition.id, provider: options.provider, workspace: new RepoWorkspace(repo), ownFiles: definition.ownFiles, readOnlyFiles: otherFiles(pair, definition.id), maxTurns, log: options.log })
    agent.beginTask(definition.task)
    return { id: definition.id, repo, agent, ownFiles: definition.ownFiles }
  })
  const runtime = new MultiReplicaRuntime(members.map(({ id, repo, agent }) => ({ id, repo, agent })))
  await runtime.runTasks(maxTurns + 1)

  const checks = await finalChecks(members[0]!.repo, pair.fixture, { converged: runtime.converged() })
  return { ...checks, eventsDelivered: runtime.eventsDelivered, agents: members.map((member) => ({ id: member.id, ownFiles: member.ownFiles, sessions: member.agent.sessions })) }
}

async function mode2Git(spec: RunSpec, options: RunOptions): Promise<PartialResult> {
  const pair = loadTaskPair(spec.scenario)
  const maxTurns = pair.maxTurns ?? options.maxTurns
  const git = await GitPair.create(
    pair.fixture,
    pair.agents.map((agent) => agent.id),
  )
  try {
    const agents = pair.agents.map((definition) => {
      const repo = git.loadRepo(definition.id)
      const agent = new LlmAgent({ id: definition.id, provider: options.provider, workspace: new RepoWorkspace(repo), ownFiles: definition.ownFiles, readOnlyFiles: otherFiles(pair, definition.id), maxTurns, log: options.log })
      return { definition, repo, agent }
    })

    // Both agents work concurrently in isolated worktrees: no events cross between them.
    await Promise.all(
      agents.map(async ({ definition, repo, agent }) => {
        await agent.runTask(definition.task)
        git.writeRepo(definition.id, repo)
        await git.commit(definition.id, `${definition.id}: ${pair.id}`)
      }),
    )

    const merge = await git.merge()
    const merged = git.loadRepo(git.mergedTarget(), 'merged')
    const diagnostics = typecheckRepo(merged)
    const repairer = agents.at(-1)!
    const lateAgent = new LlmAgent({ id: repairer.definition.id, provider: options.provider, workspace: new RepoWorkspace(merged), ownFiles: repairer.definition.ownFiles, readOnlyFiles: otherFiles(pair, repairer.definition.id), maxTurns, log: options.log })

    if (diagnostics.length > 0 || !merge.ok) {
      await lateAgent.runLateRepair(formatDiagnostics(diagnostics), merge.ok ? '' : `Git reported textual conflicts in: ${merge.conflictedFiles.join(', ')} (conflict markers are still in the files).`)
      git.writeRepo(git.mergedTarget(), merged)
      await git.commit(git.mergedTarget(), `${repairer.definition.id}: post-merge repair`)
    }

    const checks = await finalChecks(merged, pair.fixture, { mergeConflicts: merge.conflictedFiles.length })
    return {
      ...checks,
      mergeNote: merge.message,
      eventsDelivered: [],
      agents: agents.map(({ definition, agent }) => ({ id: definition.id, ownFiles: definition.ownFiles, sessions: [...agent.sessions, ...(agent === repairer.agent ? lateAgent.sessions : [])] })),
    }
  } finally {
    await git.cleanup()
  }
}

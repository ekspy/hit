import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

import { ScriptedAgent, type ReplacementRule } from '@hit/agent'
import { Runtime, type RunReport } from '@hit/coordinator'
import { Repo, type Lang } from '@hit/repo-crdt'
import { SemanticIndex } from '@hit/semantic-indexer'

export interface ScenarioConfig {
  id: string
  title: string
  fixture: string
  typecheckCommand?: string
  testCommand?: string
  agents: string[]
  maxSteps: number
}

export type ScriptOperation =
  | { kind: 'replace'; path: string; search: string; replace: string }
  | { kind: 'create_file'; path: string; lang: Lang; content: string }
  | { kind: 'noop'; note: string }

export interface AgentScript {
  agentId: string
  operations: ScriptOperation[]
}

export interface ScenarioRunResult {
  scenario: ScenarioConfig
  run: RunReport
  diagnostics: ReturnType<SemanticIndex['diagnostics']>
  files: string[]
}

export function loadScenario(id: string): ScenarioConfig {
  return JSON.parse(readFileSync(scenarioPath(id, 'scenario.json'), 'utf8')) as ScenarioConfig
}

export function loadFixtureRepo(fixture: string, actorId = 'fixture'): Repo {
  const repo = Repo.create(actorId)
  const root = path.join(workspaceRoot(), 'fixtures', fixture, 'src')

  for (const file of listSourceFiles(root)) {
    const relative = path.posix.join('src', path.relative(root, file).split(path.sep).join(path.posix.sep))
    repo.createFile(relative, readFileSync(file, 'utf8'), relative.endsWith('.tsx') ? 'tsx' : 'ts')
  }

  return repo
}

export function loadAgentScript(scenarioId: string, agentId: string): AgentScript {
  return JSON.parse(readFileSync(scenarioPath(scenarioId, 'scripts', `${agentId}.json`), 'utf8')) as AgentScript
}

export function applyScript(repo: Repo, script: AgentScript): void {
  for (const operation of script.operations) {
    if (operation.kind === 'noop') {
      continue
    }

    if (operation.kind === 'create_file') {
      repo.createFile(operation.path, operation.content, operation.lang)
      continue
    }

    const content = repo.fileContent(operation.path)
    const start = content.indexOf(operation.search)

    if (start === -1) {
      throw new Error(`Script ${script.agentId} could not find text in ${operation.path}: ${operation.search}`)
    }

    repo.editFile(operation.path, {
      start,
      deleteCount: operation.search.length,
      insert: operation.replace,
    })
  }
}

export async function runScenario(id: string, agentsKind: 'scripted' = 'scripted'): Promise<ScenarioRunResult> {
  if (agentsKind !== 'scripted') {
    throw new Error(`Unsupported agent kind: ${agentsKind}`)
  }

  const scenario = loadScenario(id)
  const repo = loadFixtureRepo(scenario.fixture, 'scenario')
  const runtime = new Runtime(repo, [
    new ScriptedAgent('repair-agent', [{ type: '*' }], scriptedRepairs(id)),
  ])

  for (const agentId of scenario.agents) {
    applyScript(repo, loadAgentScript(id, agentId))
  }

  const run = await runtime.run(scenario.maxSteps)
  const index = SemanticIndex.build(repo)

  return {
    scenario,
    run,
    diagnostics: index.diagnostics(),
    files: repo.listFiles(),
  }
}

export function scriptedRepairs(id: string): ReplacementRule[] {
  if (id === '01-return-type-change') {
    return [
      {
        eventType: '*',
        path: 'src/app/checkout/page.tsx',
        search: 'payment.status',
        replace: 'payment.state',
        once: true,
      },
      {
        eventType: '*',
        path: 'src/app/checkout/page.tsx',
        search: "return payment.redirectUrl ?? 'Payment created'",
        replace: "return payment.state === 'created' ? 'Payment created' : 'Payment failed'",
        once: true,
      },
      {
        eventType: '*',
        path: 'src/tests/checkout.test.ts',
        search: "expect(CheckoutPage()).toBe('/checkout/ord_1')",
        replace: "expect(CheckoutPage()).toBe('Payment created')",
        once: true,
      },
    ]
  }

  return []
}

function scenarioPath(id: string, ...parts: string[]): string {
  return path.join(workspaceRoot(), 'packages/eval/scenarios', id, ...parts)
}

function workspaceRoot(): string {
  let current = process.cwd()

  while (current !== path.dirname(current)) {
    try {
      statSync(path.join(current, 'pnpm-workspace.yaml'))
      return current
    } catch {
      current = path.dirname(current)
    }
  }

  throw new Error('Could not find workspace root')
}

function listSourceFiles(root: string): string[] {
  return readdirSync(root)
    .flatMap((entry) => {
      const file = path.join(root, entry)
      return statSync(file).isDirectory() ? listSourceFiles(file) : [file]
    })
    .filter((file) => file.endsWith('.ts') || file.endsWith('.tsx'))
    .sort()
}

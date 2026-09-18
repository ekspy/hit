import { Repo } from '@hit/repo-crdt'
import { describe, expect, it } from 'vitest'

import { LlmAgent, RepoWorkspace, type ChatRequest, type ChatResponse, type LlmProvider } from '../src/index.js'

/** Scripted provider: each entry is the tool call list the "model" returns for that turn. */
function fakeProvider(turns: Array<Array<{ name: string; args: Record<string, unknown> }>>): LlmProvider & { requests: ChatRequest[] } {
  const requests: ChatRequest[] = []
  return {
    model: 'gpt-5.6-terra',
    requests,
    async chat(request): Promise<ChatResponse> {
      requests.push(structuredClone(request))
      const calls = turns[requests.length - 1] ?? []
      return {
        text: calls.length === 0 ? 'thinking out loud' : '',
        toolCalls: calls.map((call, index) => ({ id: `c${requests.length}-${index}`, ...call })),
        usage: { input: 10, output: 5 },
        latencyMs: 1,
      }
    },
  }
}

function repo(): Repo {
  const r = Repo.create('llm-test')
  r.createFile('src/a.ts', 'export function a(): number { return 1 }\n', 'ts')
  r.createFile('src/b.ts', "import { a } from './a'\nexport const b: string = a()\n", 'ts')
  return r
}

describe('LlmAgent', () => {
  it('repairs from an event using tools, applies edits to its replica and returns a noop action', async () => {
    const r = repo()
    const provider = fakeProvider([
      [{ name: 'read_file', args: { path: 'src/b.ts' } }],
      [{ name: 'edit_file', args: { path: 'src/b.ts', search: 'b: string', replace: 'b: number' } }, { name: 'run_typecheck', args: {} }],
      [{ name: 'done', args: { summary: 'fixed b' } }],
    ])
    const agent = new LlmAgent({ id: 'agent-b', provider, workspace: new RepoWorkspace(r), ownFiles: ['src/b.ts'], readOnlyFiles: ['src/a.ts'] })
    const actions = await agent.onEvents({
      repo: r,
      index: undefined as never,
      myClaims: [],
      events: [{ type: 'symbol_signature_changed', symbolId: 'src/a.ts#a', from: 'a(): string', to: 'a(): number', consumers: ['src/b.ts'] }],
    })

    expect(actions).toEqual([{ kind: 'noop', note: expect.stringContaining('1 edit') }])
    expect(r.fileContent('src/b.ts')).toContain('b: number')
    const session = agent.sessions[0]!
    expect(session).toMatchObject({ kind: 'repair', turns: 3, edits: 1, done: true, summary: 'fixed b', usage: { input: 30, output: 15 } })
    expect(session.turnRecords[0]?.userMessage).toContain('symbol_signature_changed: src/a.ts#a')
    expect(session.turnRecords[2]?.toolCalls[1]?.output).toBe('Typecheck passed: 0 diagnostics.')
    expect(provider.requests[0]?.system).toContain('You own these files: src/b.ts')
    expect(provider.requests[2]?.messages.at(-1)?.role).toBe('tool')
  })

  it('injects pushed events as a user message before the next turn and stops at maxTurns', async () => {
    const r = repo()
    const provider = fakeProvider([[{ name: 'list_files', args: {} }], [{ name: 'read_file', args: { path: 'src/a.ts' } }], [{ name: 'read_file', args: { path: 'src/a.ts' } }]])
    const agent = new LlmAgent({ id: 'agent-a', provider, workspace: new RepoWorkspace(r), maxTurns: 3 })
    agent.beginTask('do something')
    expect(await agent.nextTurn()).toBe('continue')
    agent.pushEvents([{ type: 'symbol_removed', symbolId: 'src/a.ts#a', consumers: ['src/b.ts'] }])
    expect(await agent.nextTurn()).toBe('continue')
    expect(provider.requests[1]?.messages.at(-1)).toMatchObject({ role: 'user', text: expect.stringContaining('[hit] impact event') })
    expect(agent.sessions).toHaveLength(0)
    expect(await agent.nextTurn()).toBe('done')
    expect(agent.taskDone()).toBe(true)
    expect(agent.sessions[0]).toMatchObject({ kind: 'task', turns: 3, done: false })
    expect(agent.sessions[0]?.turnRecords[2]?.injectedEvents).toHaveLength(1)
  })

  it('nudges once when the model answers with prose, then gives up', async () => {
    const provider = fakeProvider([[], []])
    const agent = new LlmAgent({ id: 'x', provider, workspace: new RepoWorkspace(repo()) })
    const session = await agent.runTask('anything')
    expect(session.done).toBe(false)
    expect(session.turns).toBe(2)
    expect(provider.requests[1]?.messages.at(-1)).toMatchObject({ role: 'user', text: expect.stringContaining('continue using the tools') })
  })

  it('records provider errors instead of throwing', async () => {
    const provider: LlmProvider = {
      model: 'gpt-5.6-terra',
      async chat() {
        throw new Error('provider exploded')
      },
    }
    const agent = new LlmAgent({ id: 'x', provider, workspace: new RepoWorkspace(repo()) })
    const session = await agent.runLateRepair('src/b.ts:2:14 TS2322 boom')
    expect(session).toMatchObject({ kind: 'late-repair', done: false, error: 'provider exploded' })
  })
})

import { Repo } from '@hit/repo-crdt'
import { describe, expect, it } from 'vitest'

import { Runtime, type Agent } from '../src/index.js'

describe('Runtime', () => {
  it('dispatches semantic events and applies agent edits', async () => {
    const repo = Repo.create('runtime')
    repo.createFile('src/api.ts', "export function api(): { value: string } {\nreturn { value: 'ok' }\n}\n", 'ts')
    repo.createFile('src/app.ts', "import { api } from './api'\nexport const value = api().value\n", 'ts')
    const agent: Agent = {
      id: 'fixer',
      subscriptions: [{ type: 'consumer_impacted', file: 'src/app.ts' }],
      async onEvent(ctx) {
        const content = ctx.repo.fileContent('src/app.ts')
        const start = content.indexOf('.value')

        if (start === -1) {
          return [{ kind: 'noop', note: 'already repaired' }]
        }

        return [
          {
            kind: 'edit_file',
            path: 'src/app.ts',
            edit: {
              start,
              deleteCount: '.value'.length,
              insert: '.label',
            },
          },
        ]
      },
    }
    const runtime = new Runtime(repo, [agent])
    const content = repo.fileContent('src/api.ts')
    repo.editFile('src/api.ts', {
      start: content.indexOf('value: string'),
      deleteCount: 'value: string'.length,
      insert: 'label: string',
    })
    repo.editFile('src/api.ts', {
      start: repo.fileContent('src/api.ts').indexOf('value:'),
      deleteCount: 'value:'.length,
      insert: 'label:',
    })

    const report = await runtime.step()

    expect(report.events.map((event) => event.type)).toContain('consumer_impacted')
    expect(report.actions.filter(({ action }) => action.kind === 'edit_file')).toHaveLength(1)
    expect(repo.fileContent('src/app.ts')).toContain('api().label')
  })
})

describe('MultiReplicaRuntime', () => {
  it('delivers events derived from changes that arrived via sync, never an agent\'s own edits, and converges', async () => {
    const { MultiReplicaRuntime } = await import('../src/index.js')
    const { Repo } = await import('@hit/repo-crdt')
    const seed = Repo.create('seed')
    seed.createFile('src/api.ts', 'export function api(): string { return "x" }\n', 'ts')
    seed.createFile('src/app.ts', "import { api } from './api'\nexport const value: string = api()\n", 'ts')
    const repoA = Repo.load('agent-a', seed.save())
    const repoB = Repo.load('agent-b', seed.save())
    const seenByB: string[] = []
    const agentB = {
      id: 'agent-b',
      subscriptions: [{ type: '*' as const }],
      async onEvent(ctx: { event: { type: string }; repo: { fileContent(path: string): string } }) {
        seenByB.push(ctx.event.type)
        const content = ctx.repo.fileContent('src/app.ts')
        return [{ kind: 'edit_file' as const, path: 'src/app.ts', edit: { start: content.indexOf('string'), deleteCount: 6, insert: 'number' } }]
      },
    }
    const runtime = new MultiReplicaRuntime([
      { id: 'agent-a', repo: repoA },
      { id: 'agent-b', repo: repoB, agent: agentB },
    ])

    const content = repoA.fileContent('src/api.ts')
    repoA.editFile('src/api.ts', { start: content.indexOf('string { return "x"'), deleteCount: 'string { return "x"'.length, insert: 'number { return 1' })
    expect(repoB.fileContent('src/api.ts')).toContain('string')

    const step = await runtime.step()
    const reportB = step.members.find((member) => member.memberId === 'agent-b')!
    expect(reportB.events.map((event) => event.type)).toContain('symbol_signature_changed')
    expect(seenByB.length).toBeGreaterThan(0)
    expect(runtime.converged()).toBe(true)
    expect(repoA.fileContent('src/app.ts')).toContain('value: number')
    expect(step.members.find((member) => member.memberId === 'agent-a')?.events).toEqual([])

    const second = await runtime.step()
    expect(second.members.every((member) => member.events.length === 0)).toBe(true)
  })

  it('runs task agents round-robin, syncing after every turn and pushing events to the other agent', async () => {
    const { MultiReplicaRuntime } = await import('../src/index.js')
    const { Repo } = await import('@hit/repo-crdt')
    const seed = Repo.create('seed')
    seed.createFile('src/api.ts', 'export function api(): string { return "x" }\n', 'ts')
    seed.createFile('src/app.ts', "import { api } from './api'\nexport const value: string = api()\n", 'ts')
    const repoA = Repo.load('agent-a', seed.save())
    const repoB = Repo.load('agent-b', seed.save())
    const pushedToB: string[] = []
    let turnsA = 0
    const agentA = {
      id: 'agent-a',
      subscriptions: [{ type: '*' as const }],
      async onEvent() {
        return []
      },
      async nextTurn() {
        turnsA += 1
        if (turnsA === 1) {
          const content = repoA.fileContent('src/api.ts')
          repoA.editFile('src/api.ts', { start: content.indexOf('string { return "x"'), deleteCount: 'string { return "x"'.length, insert: 'number { return 1' })
          return 'continue' as const
        }
        return 'done' as const
      },
      pushEvents() {},
      taskDone: () => turnsA >= 2,
    }
    const agentB = {
      id: 'agent-b',
      subscriptions: [{ type: '*' as const }],
      async onEvent() {
        return []
      },
      async nextTurn() {
        return 'done' as const
      },
      pushEvents(events: Array<{ type: string }>) {
        pushedToB.push(...events.map((event) => event.type))
      },
      taskDone: () => pushedToB.length > 0,
    }
    const runtime = new MultiReplicaRuntime([
      { id: 'agent-a', repo: repoA, agent: agentA },
      { id: 'agent-b', repo: repoB, agent: agentB },
    ])
    const rounds = await runtime.runTasks(5)
    expect(pushedToB).toContain('symbol_signature_changed')
    expect(rounds[0]?.turns[0]?.deliveredTo[0]?.memberId).toBe('agent-b')
    expect(runtime.converged()).toBe(true)
    expect(repoB.fileContent('src/api.ts')).toContain('number')
  })
})

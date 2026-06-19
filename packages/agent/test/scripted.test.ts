import { Repo } from '@hit/repo-crdt'
import { describe, expect, it } from 'vitest'

import { LlmAgent, ScriptedAgent } from '../src/index.js'

describe('ScriptedAgent', () => {
  it('returns deterministic edit actions for matching events', async () => {
    const repo = Repo.create('script')
    repo.createFile('src/app.ts', 'export const value = oldName\n', 'ts')
    const agent = new ScriptedAgent(
      'scripted',
      [{ type: 'consumer_impacted' }],
      [{ eventType: 'consumer_impacted', path: 'src/app.ts', search: 'oldName', replace: 'newName' }],
    )
    const actions = await agent.onEvent({
      repo,
      index: undefined as never,
      myClaims: [],
      event: {
        type: 'consumer_impacted',
        conflict: {
          id: 'c',
          rule: 'R1',
          level: 1,
          severity: 'medium',
          origin: { file: 'src/api.ts' },
          affected: [{ file: 'src/app.ts' }],
          reason: 'changed',
          status: 'pending',
        },
      },
    })

    expect(actions).toEqual([
      {
        kind: 'edit_file',
        path: 'src/app.ts',
        edit: { start: 21, deleteCount: 7, insert: 'newName' },
      },
    ])
  })

  it('builds prompts without calling a provider', async () => {
    const repo = Repo.create('llm')
    const agent = new LlmAgent('llm')
    const actions = await agent.onEvent({
      repo,
      index: undefined as never,
      myClaims: [],
      event: {
        type: 'symbol_removed',
        symbolId: 'src/a.ts#a',
        consumers: [],
      },
    })

    expect(actions[0]).toEqual({ kind: 'noop', note: 'LLM provider calls are disabled in the preliminary prototype' })
    expect(agent.prompts).toHaveLength(1)
  })
})

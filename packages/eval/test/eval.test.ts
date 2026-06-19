import { describe, expect, it } from 'vitest'

import { Repo } from '@hit/repo-crdt'

import { applyScript, packageName, runScenario } from '../src/index.js'

describe('eval scaffold', () => {
  it('loads package exports', () => {
    expect(packageName).toBe('@hit/eval')
  })

  it('runs the scripted return type scenario to zero diagnostics', async () => {
    const result = await runScenario('01-return-type-change', 'scripted')

    expect(result.diagnostics).toEqual([])
    expect(result.run.steps.flatMap((step) => step.events).length).toBeGreaterThan(0)
  })

  it('supports replacing all non-overlapping script occurrences', () => {
    const repo = Repo.create('script-test')
    repo.createFile('src/a.ts', 'export const first = customerEmail\nexport const second = customerEmail\n', 'ts')

    applyScript(repo, {
      agentId: 'agent-a',
      operations: [
        {
          kind: 'replace',
          path: 'src/a.ts',
          search: 'customerEmail',
          replace: 'email',
          occurrence: 'all',
        },
      ],
    })

    expect(repo.fileContent('src/a.ts')).toBe('export const first = email\nexport const second = email\n')
  })
})

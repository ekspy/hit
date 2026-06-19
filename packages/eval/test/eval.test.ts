import { describe, expect, it } from 'vitest'

import { packageName, runScenario } from '../src/index.js'

describe('eval scaffold', () => {
  it('loads package exports', () => {
    expect(packageName).toBe('@hit/eval')
  })

  it('runs the scripted return type scenario to zero diagnostics', async () => {
    const result = await runScenario('01-return-type-change', 'scripted')

    expect(result.diagnostics).toEqual([])
    expect(result.run.steps.flatMap((step) => step.events).length).toBeGreaterThan(0)
  })
})

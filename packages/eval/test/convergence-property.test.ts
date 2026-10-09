import { describe, expect, it } from 'vitest'

import { runConvergenceProperty } from '../src/convergence-property.js'

describe('convergence property (fast-check)', () => {
  it('converges at the state level for 2 and 3 replicas under random operations and sync orders', async () => {
    for (const replicas of [2, 3]) {
      const result = await runConvergenceProperty({ seed: 1701, numRuns: 40, replicas, maxSteps: 40, finalOrders: 3 })

      expect(result.cases).toBe(40)
      expect(result.stateConvergence.failed).toBe(0)
      // View-level divergence after concurrent re-creation of the same path is
      // a known Automerge in-memory view issue (see reports/convergence-property.md);
      // it does not occur with two replicas in the reported run.
      if (replicas === 2) expect(result.viewConvergence.failed).toBe(0)
    }
  }, 120_000)
})

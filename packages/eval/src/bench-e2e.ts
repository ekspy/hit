import { performance } from 'node:perf_hooks'

import { MultiReplicaRuntime } from '@hit/coordinator'
import { Repo } from '@hit/repo-crdt'

import { percentiles } from './metrics.js'
import { loadFixtureRepo } from './scenario.js'

/**
 * End-to-end propagation latency between two replicas: edit on replica A, sync A->B,
 * reindex B, diff against B's last-seen index, impact analysis, events ready for B's agent.
 * Reports the total and each stage. Run: pnpm exec tsx --tsconfig packages/eval/tsconfig.json packages/eval/src/bench-e2e.ts
 */
export function propagationBenchE2E(iterations = 25) {
  const total: number[] = []
  const edit: number[] = []
  const sync: number[] = []
  const observe: number[] = []
  let events = 0

  for (let index = 0; index < iterations; index += 1) {
    const seed = loadFixtureRepo('shopapp', `e2e-${index}`)
    const repoA = Repo.load('agent-a', seed.save())
    const repoB = Repo.load('agent-b', seed.save())
    const runtime = new MultiReplicaRuntime([
      { id: 'agent-a', repo: repoA },
      { id: 'agent-b', repo: repoB },
    ])
    const content = repoA.fileContent('src/lib/payments.ts')
    const t0 = performance.now()
    repoA.editFile('src/lib/payments.ts', { start: content.indexOf("'created'"), deleteCount: "'created'".length, insert: "'started'" })
    const t1 = performance.now()
    runtime.syncAll()
    const t2 = performance.now()
    const observed = runtime.observe('agent-b')
    const t3 = performance.now()
    events = observed.events.length
    edit.push(t1 - t0)
    sync.push(t2 - t1)
    observe.push(t3 - t2)
    total.push(t3 - t0)
  }

  return { iterations, eventsPerIteration: events, stages: { edit: percentiles(edit), sync: percentiles(sync), observe: percentiles(observe) }, total: percentiles(total) }
}

if (process.argv[1]?.endsWith('bench-e2e.ts')) {
  console.log(JSON.stringify(propagationBenchE2E(), null, 2))
}

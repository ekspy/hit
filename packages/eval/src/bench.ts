import { ImpactEngine } from '@hit/impact-engine'
import { SemanticIndex, semanticDiff } from '@hit/semantic-indexer'
import { performance } from 'node:perf_hooks'

import { percentiles } from './metrics.js'
import { loadFixtureRepo } from './scenario.js'

export function propagationBench(iterations = 25): {
  iterations: number
  files: number
  symbols: number
  modes: {
    fullRebuild: { latencyMs: ReturnType<typeof percentiles> }
    incremental: { latencyMs: ReturnType<typeof percentiles> }
  }
} {
  const fullValues: number[] = []
  const incrementalValues: number[] = []
  let files = 0
  let symbols = 0

  for (let index = 0; index < iterations; index += 1) {
    fullValues.push(measure(index, 'fullRebuild'))
    incrementalValues.push(measure(index, 'incremental'))

    const repo = loadFixtureRepo('shopapp', `bench-count-${index}`)
    const after = SemanticIndex.build(repo)
    files = repo.listFiles().length
    symbols = after.symbols().length
  }

  return {
    iterations,
    files,
    symbols,
    modes: {
      fullRebuild: { latencyMs: percentiles(fullValues) },
      incremental: { latencyMs: percentiles(incrementalValues) },
    },
  }
}

function measure(index: number, mode: 'fullRebuild' | 'incremental'): number {
  const repo = loadFixtureRepo('shopapp', `bench-${mode}-${index}`)
  const before = SemanticIndex.build(repo)
  const content = repo.fileContent('src/lib/payments.ts')
  const start = performance.now()
  repo.editFile('src/lib/payments.ts', {
    start: content.indexOf("'created'"),
    deleteCount: "'created'".length,
    insert: "'started'",
  })
  const after = mode === 'fullRebuild' ? SemanticIndex.build(repo) : before.update(repo, ['src/lib/payments.ts'])
  new ImpactEngine().analyze(semanticDiff(before, after), after)
  return performance.now() - start
}

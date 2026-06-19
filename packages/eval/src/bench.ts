import { ImpactEngine } from '@hit/impact-engine'
import { SemanticIndex, semanticDiff } from '@hit/semantic-indexer'
import { performance } from 'node:perf_hooks'

import { percentiles } from './metrics.js'
import { loadFixtureRepo } from './scenario.js'

export function propagationBench(iterations = 25): {
  iterations: number
  files: number
  symbols: number
  fullRebuild: boolean
  latencyMs: ReturnType<typeof percentiles>
} {
  const values: number[] = []
  let files = 0
  let symbols = 0

  for (let index = 0; index < iterations; index += 1) {
    const repo = loadFixtureRepo('shopapp', `bench-${index}`)
    const before = SemanticIndex.build(repo)
    const content = repo.fileContent('src/lib/payments.ts')
    const start = performance.now()
    repo.editFile('src/lib/payments.ts', {
      start: content.indexOf("'created'"),
      deleteCount: "'created'".length,
      insert: "'started'",
    })
    const after = SemanticIndex.build(repo)
    new ImpactEngine().analyze(semanticDiff(before, after), after)
    values.push(performance.now() - start)
    files = repo.listFiles().length
    symbols = after.symbols().length
  }

  return {
    iterations,
    files,
    symbols,
    fullRebuild: true,
    latencyMs: percentiles(values),
  }
}

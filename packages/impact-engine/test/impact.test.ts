import { Repo } from '@hit/repo-crdt'
import { SemanticIndex, semanticDiff } from '@hit/semantic-indexer'
import { describe, expect, it } from 'vitest'

import { ImpactEngine, scoreConflicts } from '../src/index.js'

function repoWith(content: string, consumer = "import { createPayment } from './payments'\nexport const checkout = createPayment({ orderId: 'ord_1', amountCents: 100 }).status\n"): Repo {
  const repo = Repo.create('test')
  repo.createFile('src/payments.ts', content, 'ts')
  repo.createFile('src/checkout.ts', consumer, 'ts')
  return repo
}

describe('ImpactEngine', () => {
  it('detects signature and return-shape changes with live consumers', () => {
    const before = repoWith("export function createPayment(input: { orderId: string; amountCents: number }): { id: string; status: 'created' | 'failed'; redirectUrl?: string } {\nreturn { id: input.orderId, status: 'created', redirectUrl: '/' }\n}\n")
    const after = repoWith("export function createPayment(input: { orderId: string; amountCents: number }): { id: string; state: 'created' | 'failed' } {\nreturn { id: input.orderId, state: 'created' }\n}\n")
    const previous = SemanticIndex.build(before)
    const current = SemanticIndex.build(after)
    const conflicts = new ImpactEngine().analyze(semanticDiff(previous, current), current)

    expect(conflicts.map((conflict) => conflict.rule)).toEqual(expect.arrayContaining(['R1', 'R5']))
    expect(conflicts.find((conflict) => conflict.rule === 'R1')?.affected[0]?.file).toBe('src/checkout.ts')
  })

  it('detects removed exported symbols through diagnostics', () => {
    const before = repoWith('export function createPayment(): string {\nreturn "ok"\n}\n')
    const after = repoWith('export function startPayment(): string {\nreturn "ok"\n}\n')
    const previous = SemanticIndex.build(before)
    const current = SemanticIndex.build(after)
    const conflicts = new ImpactEngine().analyze(semanticDiff(previous, current), current)

    expect(conflicts.map((conflict) => conflict.rule)).toEqual(expect.arrayContaining(['R2', 'R3']))
  })

  it('scores labels by rule, origin symbol, and affected file', () => {
    const report = scoreConflicts(
      [
        {
          id: 'one',
          rule: 'R1',
          level: 1,
          severity: 'medium',
          origin: { file: 'src/payments.ts', symbolId: 'src/payments.ts#createPayment' },
          affected: [{ file: 'src/checkout.ts' }],
          reason: 'changed',
          status: 'pending',
        },
      ],
      [
        {
          rule: 'R1',
          level: 1,
          origin: { file: 'src/payments.ts', symbol: 'createPayment' },
          affected: [{ file: 'src/checkout.ts', symbol: 'createPayment' }],
        },
      ],
    )

    expect(report.precision).toBe(1)
    expect(report.recall).toBe(1)
  })
})

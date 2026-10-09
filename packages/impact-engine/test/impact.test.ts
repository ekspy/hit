import { Repo } from '@hit/repo-crdt'
import { SemanticIndex, semanticDiff } from '@hit/semantic-indexer'
import { describe, expect, it } from 'vitest'

import { ImpactEngine, groupLogicalConflicts, scoreConflicts, type Conflict } from '../src/index.js'

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

  it('scores labels by logical conflict rather than raw rule firings', () => {
    const report = scoreConflicts(
      [
        {
          id: 'r1',
          rule: 'R1',
          level: 1,
          severity: 'medium',
          origin: { file: 'src/payments.ts', symbolId: 'src/payments.ts#createPayment' },
          affected: [{ file: 'src/checkout.ts' }],
          reason: 'changed',
          status: 'pending',
        },
        {
          id: 'r4',
          rule: 'R4',
          level: 1,
          severity: 'high',
          origin: { file: 'src/checkout.ts' },
          affected: [{ file: 'src/checkout.ts' }],
          reason: "TypeScript diagnostic 2339: Property 'status' does not exist on type 'PaymentResult'.",
          status: 'pending',
        },
        {
          id: 'r5',
          rule: 'R5',
          level: 2,
          severity: 'medium',
          origin: { file: 'src/payments.ts', symbolId: 'src/payments.ts#createPayment' },
          affected: [{ file: 'src/checkout.ts', symbolId: 'src/payments.ts#createPayment' }],
          reason: 'Return shape changed for createPayment',
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
    expect(report.logicalConflicts).toHaveLength(1)
    expect(report.matches[0]).toEqual(expect.objectContaining({ expectedRule: 'R1' }))
    expect(report.matches[0]?.rawRules).toEqual(expect.arrayContaining(['R1', 'R4', 'R5']))
  })

  it('groups rename diagnostics with removed symbol conflicts', () => {
    const conflicts: Conflict[] = [
      {
        id: 'r2',
        rule: 'R2',
        level: 1,
        severity: 'medium',
        origin: { file: 'src/payments.ts', symbolId: 'src/payments.ts#createPayment' },
        affected: [{ file: 'src/checkout.ts' }],
        reason: 'Exported symbol createPayment was removed or renamed',
        status: 'pending',
      },
      {
        id: 'r3',
        rule: 'R3',
        level: 1,
        severity: 'high',
        origin: { file: 'src/checkout.ts' },
        affected: [{ file: 'src/checkout.ts' }],
        reason: "TypeScript diagnostic 2305: Module './payments' has no exported member 'createPayment'.",
        status: 'pending',
      },
    ]

    const grouped = groupLogicalConflicts(conflicts)

    expect(grouped).toHaveLength(1)
    expect(grouped[0]?.conflicts.map((conflict) => conflict.rule)).toEqual(['R2', 'R3'])
  })

  it('keeps distinct unresolved diagnostics on the same file pair as separate conflicts', () => {
    const before = Repo.create('test')
    before.createFile('src/inventory.ts', "export enum Status { A = 'a', B = 'b' }\nexport class Service {\n  reserve(): boolean { return true }\n}\n", 'ts')
    before.createFile(
      'src/page.ts',
      "import { Service, Status } from './inventory'\nexport function label(s: Status): string {\n  if (s === Status.B) return 'b'\n  return 'a'\n}\nexport const ok = new Service().reserve()\n",
      'ts',
    )
    const previous = SemanticIndex.build(before)
    before.editFile('src/inventory.ts', { start: 0, deleteCount: before.fileContent('src/inventory.ts').length, insert: "export enum Status { A = 'a' }\nexport class Service {\n  hold(): boolean { return true }\n}\n" })
    const current = SemanticIndex.build(before)
    const conflicts = new ImpactEngine().analyze(semanticDiff(previous, current), current)
    const unresolved = conflicts.filter((conflict) => conflict.rule === 'R4' && !conflict.origin.symbolId)

    expect(unresolved).toHaveLength(2)
    expect(groupLogicalConflicts(unresolved)).toHaveLength(2)
  })

  it('matches diagnostic-only removed field evidence through quoted identifiers', () => {
    const report = scoreConflicts(
      [
        {
          id: 'r4',
          rule: 'R4',
          level: 1,
          severity: 'high',
          origin: { file: 'src/lib/orders.ts' },
          affected: [{ file: 'src/lib/orders.ts' }],
          reason: "TypeScript diagnostic 2339: Property 'customerEmail' does not exist on type 'OrderRecord'.",
          status: 'pending',
        },
      ],
      [
        {
          rule: 'R4',
          level: 1,
          rationale: 'Consumer receives TS 2339 after OrderRecord.customerEmail is renamed.',
          origin: { file: 'src/lib/db.ts', symbol: 'OrderRecord.customerEmail' },
          affected: [{ file: 'src/lib/orders.ts', symbol: 'customerEmail' }],
        },
      ],
    )

    expect(report.truePositives).toBe(1)
    expect(report.falseNegatives).toBe(0)
  })

  it('counts logical conflicts as false positives in zero-label controls', () => {
    const report = scoreConflicts(
      [
        {
          id: 'r9',
          rule: 'R9',
          level: 3,
          severity: 'high',
          origin: { file: 'src/app.ts' },
          affected: [{ file: 'src/app.ts' }],
          reason: "TypeScript diagnostic 2304: Cannot find name 'missing'.",
          status: 'pending',
        },
      ],
      [],
    )

    expect(report.truePositives).toBe(0)
    expect(report.falsePositives).toBe(1)
    expect(report.recall).toBe(1)
  })
})

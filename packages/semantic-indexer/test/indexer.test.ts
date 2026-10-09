import { readFileSync } from 'node:fs'
import path from 'node:path'

import { Repo } from '@hit/repo-crdt'
import { describe, expect, it } from 'vitest'

import { SemanticIndex, semanticDiff } from '../src/index.js'

function shopRepo(): Repo {
  const repo = Repo.create('fixture')
  const root = path.resolve('fixtures/shopapp')

  for (const file of [
    'src/lib/db.ts',
    'src/lib/payments.ts',
    'src/lib/orders.ts',
    'src/app/checkout/page.tsx',
    'src/app/orders/page.tsx',
    'src/tests/checkout.test.ts',
  ]) {
    repo.createFile(file, readFileSync(path.join(root, file), 'utf8'), file.endsWith('.tsx') ? 'tsx' : 'ts')
  }

  return repo
}

describe('SemanticIndex', () => {
  it('indexes exported symbols and references in shopapp', () => {
    const index = SemanticIndex.build(shopRepo())

    expect(index.symbolById('src/lib/payments.ts#createPayment')?.signature).toContain('PaymentResult')
    expect(index.consumersOf('src/lib/payments.ts#createPayment')).toEqual([
      {
        fromFile: 'src/app/checkout/page.tsx',
        symbolId: 'src/lib/payments.ts#createPayment',
        loc: expect.objectContaining({ line: 1 }),
      },
    ])
    expect(index.dependencyGraph().get('src/app/checkout/page.tsx')).toEqual(new Set(['src/lib/payments.ts']))
    expect(index.diagnostics()).toEqual([])
  })

  it('reports semantic signature changes', () => {
    const before = shopRepo()
    const after = Repo.load('after', before.save())
    const content = after.fileContent('src/lib/payments.ts')
    after.editFile('src/lib/payments.ts', {
      start: content.indexOf('): PaymentResult'),
      deleteCount: '): PaymentResult'.length,
      insert: '): { id: string; status: "created" | "failed" }',
    })

    const diff = semanticDiff(SemanticIndex.build(before), SemanticIndex.build(after))

    expect(diff.changed.map((change) => change.before.id)).toContain('src/lib/payments.ts#createPayment')
  })

  it('keeps incremental update output equivalent to a full rebuild', () => {
    const repo = shopRepo()
    const incrementalStart = SemanticIndex.build(repo)
    const payments = repo.fileContent('src/lib/payments.ts')
    repo.editFile('src/lib/payments.ts', {
      start: payments.indexOf("status: 'created' | 'failed'"),
      deleteCount: "status: 'created' | 'failed'".length,
      insert: "state: 'created' | 'failed'",
    })
    repo.editFile('src/lib/payments.ts', {
      start: repo.fileContent('src/lib/payments.ts').indexOf('status: input.amountCents'),
      deleteCount: 'status: input.amountCents'.length,
      insert: 'state: input.amountCents',
    })
    const checkout = repo.fileContent('src/app/checkout/page.tsx')
    repo.editFile('src/app/checkout/page.tsx', {
      start: checkout.indexOf('payment.status'),
      deleteCount: 'payment.status'.length,
      insert: 'payment.state',
    })

    const incremental = incrementalStart.update(repo, ['src/lib/payments.ts', 'src/app/checkout/page.tsx'])
    const full = SemanticIndex.build(repo)

    expect(serializeIndex(incremental)).toEqual(serializeIndex(full))
  })

  it('resolves diagnostics to the producer declaration with the checker', () => {
    const repo = Repo.create('producers')
    repo.createFile('src/model.ts', 'export interface Row { id: string; size: string }\nexport enum Mode { On = "on" }\n', 'ts')
    repo.createFile(
      'src/api.ts',
      [
        "import type { Row } from './model'",
        'export function scale(value: number): number',
        'export function scale(value: number, by?: number): number { return value * (by ?? 1) }',
        'export function load() { return [{ id: "a", size: "1" }] as Row[] }',
        '',
      ].join('\n'),
      'ts',
    )
    repo.createFile(
      'src/use.ts',
      [
        "import scaleDefault from './api'",
        "import { scale, load } from './api'",
        "import { Mode } from './model'",
        'export const a = scale(1, 2)',
        'export function b(): boolean {',
        '  const [first] = load()',
        '  const { size } = first!',
        '  return size > 3',
        '}',
        'export function c(mode: Mode): string {',
        '  switch (mode) {',
        '    case Mode.Off:',
        "      return 'off'",
        '  }',
        '}',
        'export const d = scaleDefault',
        '',
      ].join('\n'),
      'ts',
    )

    const producers = SemanticIndex.build(repo)
      .diagnostics()
      .map((diagnostic) => [diagnostic.code, diagnostic.producer])

    expect(producers).toEqual(
      expect.arrayContaining([
        [1192, { file: 'src/api.ts', via: 'import' }],
        [2554, { file: 'src/api.ts', symbol: 'scale', via: 'call' }],
        [2365, { file: 'src/model.ts', symbol: 'Row', member: 'size', via: 'reference' }],
        [2339, { file: 'src/model.ts', symbol: 'Mode', via: 'reference' }],
        [2366, { file: 'src/model.ts', symbol: 'Mode', via: 'cascade' }],
      ]),
    )
  })
})

function serializeIndex(index: SemanticIndex): unknown {
  return {
    symbols: index.symbols(),
    references: index.symbols().flatMap((symbol) => index.consumersOf(symbol.id)),
    graph: [...index.dependencyGraph()]
      .map(([file, dependencies]) => [file, [...dependencies].sort()])
      .sort(([left], [right]) => String(left).localeCompare(String(right))),
    diagnostics: index.diagnostics(),
  }
}

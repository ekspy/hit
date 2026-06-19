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
})

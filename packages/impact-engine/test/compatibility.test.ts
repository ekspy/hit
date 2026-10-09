import { readFileSync } from 'node:fs'
import path from 'node:path'

import { Repo } from '@hit/repo-crdt'
import { SemanticIndex, semanticDiff, type SymbolChange, type SymbolInfo } from '@hit/semantic-indexer'
import { describe, expect, it } from 'vitest'

import { classifyChange, parseParameters } from '../src/compatibility.js'
import { ImpactEngine, groupLogicalConflicts } from '../src/index.js'

function fn(overrides: Partial<SymbolInfo>): SymbolInfo {
  return {
    id: 'src/payments.ts#createPayment',
    name: 'createPayment',
    kind: 'function',
    file: 'src/payments.ts',
    signature: 'createPayment(input: PaymentInput): PaymentResult',
    exported: true,
    parameters: [{ name: 'input', optional: false, typeText: 'PaymentInput', unionMembers: ['PaymentInput'] }],
    returnTypeText: 'PaymentResult',
    returnShape: { text: 'PaymentResult', properties: { id: 'string', status: '"created" | "failed"' } },
    ...overrides,
  }
}

function change(before: Partial<SymbolInfo>, after: Partial<SymbolInfo>): SymbolChange {
  return { before: fn(before), after: fn(after) }
}

describe('classifyChange', () => {
  it('classifies overloads and type parameter constraints', () => {
    const one = { text: '(value: number): string', arity: 1 }
    const two = { text: '(value: number, unit: string): string', arity: 2 }
    const wide = { text: '(value: string): string', arity: 1 }

    expect(classifyChange(change({ overloads: [one, two] }, { overloads: [one] })).classification).toBe('breaking')
    expect(classifyChange(change({ overloads: [one, two] }, { overloads: [one, two, wide] })).classification).toBe('compatible')
    expect(classifyChange(change({ overloads: [one, two] }, { overloads: [wide, two] })).classification).toBe('unknown')
    expect(classifyChange(change({ typeParameters: [{ name: 'T' }] }, { typeParameters: [{ name: 'T', constraint: '{ id: string }' }] })).classification).toBe('breaking')
    expect(classifyChange(change({ typeParameters: [{ name: 'T', constraint: '{ id: string }' }] }, { typeParameters: [{ name: 'T' }] })).classification).toBe('compatible')
  })

  it('treats an added trailing optional parameter as compatible', () => {
    const verdict = classifyChange(
      change(
        {},
        {
          parameters: [
            { name: 'input', optional: false, typeText: 'PaymentInput', unionMembers: ['PaymentInput'] },
            { name: 'note', optional: true, typeText: 'string', unionMembers: ['string'] },
          ],
        },
      ),
    )

    expect(verdict.classification).toBe('compatible')
  })

  it('treats a parameter with a default value (parsed from signature text) as compatible', () => {
    const verdict = classifyChange({
      before: { ...fn({}), parameters: undefined },
      after: { ...fn({ signature: "createPayment(input: PaymentInput, source = 'web'): PaymentResult" }), parameters: undefined },
    })

    expect(parseParameters("createPayment(input: PaymentInput, source = 'web'): PaymentResult")[1]).toEqual(expect.objectContaining({ name: 'source', optional: true }))
    expect(verdict.classification).toBe('compatible')
  })

  it('treats an added optional return property as compatible', () => {
    const verdict = classifyChange(
      change({}, { returnShape: { text: 'PaymentResult', properties: { id: 'string', receiptUrl: 'string', status: '"created" | "failed"' }, optional: ['receiptUrl'] } }),
    )

    expect(verdict.classification).toBe('compatible')
  })

  it('treats a widened parameter union as compatible', () => {
    const verdict = classifyChange(
      change({}, { parameters: [{ name: 'input', optional: false, typeText: 'PaymentInput | string', unionMembers: ['PaymentInput', 'string'] }] }),
    )

    expect(verdict.classification).toBe('compatible')
  })

  it('treats a removed or renamed return property as breaking', () => {
    const verdict = classifyChange(change({}, { returnShape: { text: 'PaymentResult', properties: { id: 'string', state: '"created" | "failed"' } } }))

    expect(verdict.classification).toBe('breaking')
    expect(verdict.findings.map((item) => item.detail)).toContain('property status was removed or renamed')
  })

  it('treats a parameter made required as breaking', () => {
    const verdict = classifyChange(
      change(
        { parameters: [{ name: 'input', optional: true, typeText: 'PaymentInput', unionMembers: ['PaymentInput'] }] },
        { parameters: [{ name: 'input', optional: false, typeText: 'PaymentInput', unionMembers: ['PaymentInput'] }] },
      ),
    )

    expect(verdict.classification).toBe('breaking')
  })

  it('treats an added required parameter as breaking', () => {
    const verdict = classifyChange(
      change(
        {},
        {
          parameters: [
            { name: 'input', optional: false, typeText: 'PaymentInput', unionMembers: ['PaymentInput'] },
            { name: 'currency', optional: false, typeText: 'string', unionMembers: ['string'] },
          ],
        },
      ),
    )

    expect(verdict.classification).toBe('breaking')
  })

  it('treats a narrowed parameter union as breaking', () => {
    const verdict = classifyChange(
      change(
        { parameters: [{ name: 'input', optional: false, typeText: 'PaymentInput | string', unionMembers: ['PaymentInput', 'string'] }] },
        { parameters: [{ name: 'input', optional: false, typeText: 'PaymentInput', unionMembers: ['PaymentInput'] }] },
      ),
    )

    expect(verdict.classification).toBe('breaking')
  })

  it('treats a removed return union value as breaking', () => {
    const verdict = classifyChange(change({}, { returnShape: { text: 'PaymentResult', properties: { id: 'string', status: '"created"' } } }))

    expect(verdict.classification).toBe('breaking')
  })

  it('treats sync to async as breaking', () => {
    const verdict = classifyChange(change({}, { signature: 'createPayment(input: PaymentInput): Promise<PaymentResult>', returnTypeText: 'Promise<PaymentResult>' }))

    expect(verdict.classification).toBe('breaking')
    expect(verdict.findings[0]?.detail).toContain('asynchronous')
  })

  it('classifies anything it cannot prove as unknown', () => {
    const intersection = classifyChange(
      change({}, { parameters: [{ name: 'input', optional: false, typeText: 'PaymentInput & { amountCents: 0 }', unionMembers: ['PaymentInput & { amountCents: 0; }'] }] }),
    )
    const addedRequiredProperty = classifyChange(change({}, { returnShape: { text: 'PaymentResult', properties: { id: 'string', status: '"created" | "failed"', total: 'number' } } }))
    const textOnly = classifyChange(change({}, { signature: 'createPayment(payment: PaymentInput): PaymentResult' }))

    expect(intersection.classification).toBe('unknown')
    expect(addedRequiredProperty.classification).toBe('unknown')
    expect(textOnly.classification).toBe('unknown')
  })
})

const workspace = path.resolve(__dirname, '../../..')

function fixtureRepo(actor: string): Repo {
  const repo = Repo.create(actor)
  const root = path.join(workspace, 'fixtures/shopapp')

  for (const file of ['src/lib/db.ts', 'src/lib/payments.ts', 'src/lib/orders.ts', 'src/app/checkout/page.tsx', 'src/app/orders/page.tsx', 'src/tests/checkout.test.ts']) {
    repo.createFile(file, readFileSync(path.join(root, file), 'utf8'), file.endsWith('.tsx') ? 'tsx' : 'ts')
  }

  return repo
}

function applyScenario(repo: Repo, scenario: string): void {
  for (const agent of ['agent-a', 'agent-b']) {
    const script = JSON.parse(readFileSync(path.join(workspace, 'packages/eval/scenarios', scenario, 'scripts', `${agent}.json`), 'utf8')) as {
      operations: Array<{ kind: string; path: string; search: string; replace: string; occurrence?: string }>
    }

    for (const operation of script.operations) {
      if (operation.kind !== 'replace') {
        continue
      }

      const content = repo.fileContent(operation.path)
      const start = content.indexOf(operation.search)
      expect(start, `${scenario}: ${operation.search}`).toBeGreaterThanOrEqual(0)

      if (operation.occurrence === 'all') {
        repo.editFile(operation.path, { start: 0, deleteCount: content.length, insert: content.split(operation.search).join(operation.replace) })
      } else {
        repo.editFile(operation.path, { start, deleteCount: operation.search.length, insert: operation.replace })
      }
    }
  }
}

function scenarioConflicts(scenario: string) {
  const repo = fixtureRepo(scenario)
  const before = SemanticIndex.build(repo)
  applyScenario(repo, scenario)
  const after = SemanticIndex.build(repo)
  return new ImpactEngine().analyze(semanticDiff(before, after), after)
}

describe('compatible-change controls', () => {
  it.each(['10-compatible-change-control', '11-added-optional-param-control', '12-added-optional-return-field-control', '13-widened-param-type-control'])(
    '%s yields zero logical conflicts',
    (scenario) => {
      const conflicts = scenarioConflicts(scenario)

      expect(conflicts).toEqual([])
      expect(groupLogicalConflicts(conflicts)).toHaveLength(0)
    },
  )
})

describe('origin normalization', () => {
  it('moves a diagnostic-derived conflict origin to the changed producer symbol and keeps the consumer affected', () => {
    const conflicts = scenarioConflicts('14-interface-field-rename')
    const diagnostic = conflicts.find((conflict) => conflict.rule === 'R4')

    expect(diagnostic?.origin).toEqual({ file: 'src/lib/db.ts', symbolId: 'src/lib/db.ts#OrderRecord' })
    expect(diagnostic?.affected.map((item) => item.file)).toEqual(['src/lib/orders.ts'])
    expect(diagnostic?.classification).toBe('breaking')
  })

  it('separates two concurrent producer changes into two logical conflicts', () => {
    const grouped = groupLogicalConflicts(scenarioConflicts('16-two-producers-one-consumer'))

    expect(grouped.map((logical) => logical.primaryRule).sort()).toEqual(['R1', 'R4'])
  })
})

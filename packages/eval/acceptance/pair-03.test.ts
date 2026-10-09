import { describe, expect, it } from 'vitest'

import { load, type Page } from './_helpers'

describe('pair-03 acceptance', () => {
  it('producer: customerEmail renamed to email', async () => {
    const { orders } = await load<{ orders: Array<Record<string, unknown>> }>('../lib/db')
    expect(orders[0]!.email).toBe('ana@example.com')
    expect('customerEmail' in orders[0]!).toBe(false)
  })
  it('consumer: rich summary uses the email of the record', async () => {
    const { orderSummary } = await load<{ orderSummary: Page }>('../lib/orders')
    expect(await orderSummary('ord_1')).toBe('ana@example.com - 12.99 - pending')
  })
  it('consumer: missing order branch kept', async () => {
    const { orderSummary } = await load<{ orderSummary: Page }>('../lib/orders')
    expect(await orderSummary('ord_missing')).toBe('Missing order')
  })
})

import { describe, expect, it } from 'vitest'

import { load, type Page } from './_helpers'

describe('pair-16 acceptance', () => {
  it('producers: status renamed to state, customerEmail renamed to email', async () => {
    const { createPayment } = await load<{ createPayment: Page }>('../lib/payments')
    const payment = (await createPayment({ orderId: 'ord_1', amountCents: 1299 })) as Record<string, unknown>
    expect(payment.state).toBe('created')
    expect('status' in payment).toBe(false)
    const { orders } = await load<{ orders: Array<Record<string, unknown>> }>('../lib/db')
    expect(orders[0]!.email).toBe('ana@example.com')
  })
  it('consumer: checkout renders order summary and payment state', async () => {
    const { CheckoutPage } = await load<{ CheckoutPage: Page }>('../app/checkout/page')
    expect(await CheckoutPage()).toBe('ana@example.com: pending | created')
  })
})

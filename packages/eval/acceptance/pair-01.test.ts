import { describe, expect, it } from 'vitest'

import { load, type Page } from './_helpers'

describe('pair-01 acceptance', () => {
  it('producer: status renamed to state, redirectUrl removed', async () => {
    const { createPayment } = await load<{ createPayment: Page }>('../lib/payments')
    const result = (await createPayment({ orderId: 'ord_1', amountCents: 1299 })) as Record<string, unknown>
    expect(result.state).toBe('created')
    expect('status' in result).toBe(false)
    expect(result.redirectUrl).toBeUndefined()
  })
  it('consumer: created payment without redirect renders "Payment created"', async () => {
    const { CheckoutPage } = await load<{ CheckoutPage: Page }>('../app/checkout/page')
    expect(await CheckoutPage()).toBe('Payment created')
  })
  it('consumer: failed payment renders its id', async () => {
    const { CheckoutPage } = await load<{ CheckoutPage: Page }>('../app/checkout/page', true)
    expect(await CheckoutPage()).toBe('Payment failed (pay_ord_1)')
  })
})

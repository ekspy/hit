import { describe, expect, it } from 'vitest'

import { load, type Page } from './_helpers'

describe('pair-07 acceptance', () => {
  it('producer: createPayment returns a promise', async () => {
    const { createPayment } = await load<{ createPayment: Page }>('../lib/payments')
    expect(createPayment({ orderId: 'ord_1', amountCents: 1299 })).toBeInstanceOf(Promise)
  })
  it('consumer: successful payment renders the redirect URL', async () => {
    const { CheckoutPage } = await load<{ CheckoutPage: Page }>('../app/checkout/page')
    expect(await CheckoutPage()).toBe('/checkout/ord_1')
  })
  it('consumer: failed payment renders the retry message', async () => {
    const { CheckoutPage } = await load<{ CheckoutPage: Page }>('../app/checkout/page', true)
    expect(await CheckoutPage()).toBe('Payment failed, please retry (order ord_1)')
  })
})

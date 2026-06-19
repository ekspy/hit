import { describe, expect, it } from 'vitest'

import { CheckoutPage } from '../app/checkout/page'

describe('checkout fixture', () => {
  it('renders the checkout redirect', () => {
    expect(CheckoutPage()).toBe('/checkout/ord_1')
  })
})

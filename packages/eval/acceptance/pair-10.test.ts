import { describe, expect, it } from 'vitest'

import { load, type Page } from './_helpers'

describe('pair-10 acceptance', () => {
  it('producer: findOrder returns a promise', async () => {
    const { findOrder } = await load<{ findOrder: Page }>('../lib/db')
    expect(findOrder('ord_1')).toBeInstanceOf(Promise)
  })
  it('consumer: default list renders one summary line', async () => {
    const { OrdersPage } = await load<{ OrdersPage: Page }>('../app/orders/page')
    expect(await OrdersPage()).toBe('ana@example.com: pending')
  })
  it('consumer: several ids render one line each, missing ones included', async () => {
    const { OrdersPage } = await load<{ OrdersPage: Page }>('../app/orders/page')
    expect(await OrdersPage(['ord_1', 'ord_missing'])).toBe('ana@example.com: pending\nMissing order')
  })
  it('consumer: empty list renders "No orders"', async () => {
    const { OrdersPage } = await load<{ OrdersPage: Page }>('../app/orders/page')
    expect(await OrdersPage([])).toBe('No orders')
  })
})

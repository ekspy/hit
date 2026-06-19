import { findOrder } from './db'

export function orderSummary(id: string): string {
  const order = findOrder(id)

  if (!order) {
    return 'Missing order'
  }

  return `${order.customerEmail}: ${order.status}`
}

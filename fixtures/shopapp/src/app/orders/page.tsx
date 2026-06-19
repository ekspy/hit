import { orderSummary } from '../../lib/orders'

export function OrdersPage(): string {
  return orderSummary('ord_1')
}

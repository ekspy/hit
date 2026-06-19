export interface OrderRecord {
  id: string
  customerEmail: string
  totalCents: number
  status: 'pending' | 'paid'
}

export const orders: OrderRecord[] = [
  {
    id: 'ord_1',
    customerEmail: 'ana@example.com',
    totalCents: 1299,
    status: 'pending',
  },
]

export function findOrder(id: string): OrderRecord | undefined {
  return orders.find((order) => order.id === id)
}

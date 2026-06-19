import { createPayment } from '../../lib/payments'

export function CheckoutPage(): string {
  const payment = createPayment({ orderId: 'ord_1', amountCents: 1299 })

  if (payment.status === 'failed') {
    return 'Payment failed'
  }

  return payment.redirectUrl ?? 'Payment created'
}

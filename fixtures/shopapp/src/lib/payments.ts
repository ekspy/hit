export interface PaymentInput {
  orderId: string
  amountCents: number
}

export interface PaymentResult {
  id: string
  status: 'created' | 'failed'
  redirectUrl?: string
}

export function createPayment(input: PaymentInput): PaymentResult {
  return {
    id: `pay_${input.orderId}`,
    status: input.amountCents > 0 ? 'created' : 'failed',
    redirectUrl: `/checkout/${input.orderId}`,
  }
}

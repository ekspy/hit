import { vi } from 'vitest'

/** Fresh import of a module, optionally with createPayment forced onto its failure path (amountCents 0), whatever CheckoutPage's signature is. */
export async function load<T>(path: string, forcePaymentFailure = false): Promise<T> {
  vi.resetModules()
  vi.doUnmock('../lib/payments')
  if (forcePaymentFailure) {
    vi.doMock('../lib/payments', async (importOriginal) => {
      const real = await importOriginal<Record<string, (input: Record<string, unknown>) => unknown>>()
      return { ...real, createPayment: (input: Record<string, unknown>) => real.createPayment!({ ...input, amountCents: 0 }) }
    })
  }
  return (await import(/* @vite-ignore */ path)) as T
}

export type Page = (...args: unknown[]) => unknown

export const DEFAULT_TIMEOUT_MS = 120_000
export const DEFAULT_RETRIES = 3

export interface RetryOptions {
  retries?: number
  timeoutMs?: number
  baseDelayMs?: number
  sleep?: (ms: number) => Promise<void>
  onRetry?: (attempt: number, error: unknown) => void
}

export class LlmTimeoutError extends Error {
  readonly status = 408
  constructor(ms: number) {
    super(`LLM call timed out after ${ms} ms`)
  }
}

export function errorStatus(error: unknown): number | undefined {
  if (error && typeof error === 'object') {
    const status = (error as { status?: unknown }).status ?? (error as { statusCode?: unknown }).statusCode
    if (typeof status === 'number') {
      return status
    }
    const message = String((error as { message?: unknown }).message ?? '')
    const match = message.match(/\b(429|5\d\d)\b/)
    if (match) {
      return Number(match[1])
    }
  }
  return undefined
}

export function isRetryable(error: unknown): boolean {
  const status = errorStatus(error)
  if (status === 429 || status === 408 || (status !== undefined && status >= 500)) {
    return true
  }
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined
  return code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ECONNREFUSED' || error instanceof LlmTimeoutError
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new LlmTimeoutError(ms)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

/** Runs `fn` with a timeout and exponential backoff on 429/5xx/timeouts. Returns the value and the number of attempts. */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<{ value: T; attempts: number }> {
  const retries = options.retries ?? DEFAULT_RETRIES
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const baseDelayMs = options.baseDelayMs ?? 2_000
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  let attempt = 0

  for (;;) {
    attempt += 1
    try {
      const value = await withTimeout(fn(), timeoutMs)
      return { value, attempts: attempt }
    } catch (error) {
      if (attempt > retries || !isRetryable(error)) {
        throw error
      }
      options.onRetry?.(attempt, error)
      await sleep(baseDelayMs * 2 ** (attempt - 1) + Math.random() * 250)
    }
  }
}

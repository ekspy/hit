import { withRetry, type RetryOptions } from './retry.js'
import { costUsd, type ChatRequest, type ChatResponse, type LlmCallLog, type LlmProvider, type ModelId } from './types.js'

export type CallListener = (log: LlmCallLog) => void

/**
 * Wraps a provider with retries (3x backoff on 429/5xx), a 120 s timeout, and per-call logging
 * (usage, latency, model, cost). Every call is appended to `logs` and pushed to listeners.
 */
export class LoggingProvider implements LlmProvider {
  readonly logs: LlmCallLog[] = []
  private readonly listeners: CallListener[] = []

  constructor(
    private readonly inner: LlmProvider,
    private readonly retry: RetryOptions = {},
  ) {}

  get model(): ModelId {
    return this.inner.model
  }

  onCall(listener: CallListener): void {
    this.listeners.push(listener)
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const startedAt = new Date().toISOString()
    const started = performance.now()
    const lastUser = [...request.messages].reverse().find((message) => message.role === 'user')
    const base = {
      model: this.model,
      startedAt,
      request: {
        messageCount: request.messages.length,
        lastUserPreview: lastUser && lastUser.role === 'user' ? lastUser.text.slice(0, 200) : '',
        toolNames: request.tools.map((tool) => tool.name),
      },
    }

    try {
      const { value, attempts } = await withRetry(() => this.inner.chat(request), this.retry)
      const log: LlmCallLog = {
        ...base,
        latencyMs: value.latencyMs,
        usage: value.usage,
        costUsd: costUsd(this.model, value.usage),
        response: { text: value.text, toolCalls: value.toolCalls, stopReason: value.stopReason },
        attempts,
      }
      this.emit(log)
      return value
    } catch (error) {
      const log: LlmCallLog = {
        ...base,
        latencyMs: performance.now() - started,
        usage: { input: 0, output: 0 },
        costUsd: 0,
        response: { text: '', toolCalls: [] },
        attempts: (this.retry.retries ?? 3) + 1,
        error: error instanceof Error ? error.message : String(error),
      }
      this.emit(log)
      throw error
    }
  }

  private emit(log: LlmCallLog): void {
    this.logs.push(log)
    for (const listener of this.listeners) {
      listener(log)
    }
  }
}

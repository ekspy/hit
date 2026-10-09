/**
 * Provider-neutral chat types. Each provider adapts these to its SDK.
 */

export interface ToolDefinition {
  name: string
  description: string
  /** JSON schema (object) for the tool input. */
  parameters: Record<string, unknown>
}

export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}

export interface ToolResult {
  callId: string
  name: string
  output: string
  isError?: boolean
}

export type ChatMessage =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; toolCalls: ToolCall[]; raw?: unknown }
  | { role: 'tool'; results: ToolResult[] }

export interface ChatRequest {
  system: string
  messages: ChatMessage[]
  tools: ToolDefinition[]
}

export interface Usage {
  input: number
  output: number
}

export interface ChatResponse {
  text: string
  toolCalls: ToolCall[]
  usage: Usage
  latencyMs: number
  /** Provider-specific payload that must be echoed back verbatim in the next turn (reasoning items, thought signatures). */
  raw?: unknown
  stopReason?: string
  /** Exact model snapshot reported by the provider for this response (e.g. a dated id behind the alias). */
  modelSnapshot?: string
}

export interface LlmProvider {
  readonly model: ModelId
  chat(request: ChatRequest): Promise<ChatResponse>
}

export type ModelId = 'claude-sonnet-5' | 'gpt-5.6-terra' | 'gemini-3.1-pro-preview'

export const MODELS: readonly ModelId[] = ['claude-sonnet-5', 'gpt-5.6-terra', 'gemini-3.1-pro-preview']

/** USD per 1M tokens (input, output). Verified 2026-09-18. */
export const PRICE_TABLE: Record<ModelId, { input: number; output: number }> = {
  'claude-sonnet-5': { input: 2, output: 10 },
  'gpt-5.6-terra': { input: 2, output: 12 },
  'gemini-3.1-pro-preview': { input: 2, output: 12 },
}

export function costUsd(model: ModelId, usage: Usage): number {
  const price = PRICE_TABLE[model]
  return (usage.input * price.input + usage.output * price.output) / 1_000_000
}

export interface LlmCallLog {
  model: ModelId
  startedAt: string
  latencyMs: number
  usage: Usage
  costUsd: number
  request: { messageCount: number; lastUserPreview: string; toolNames: string[] }
  response: { text: string; toolCalls: ToolCall[]; stopReason?: string }
  attempts: number
  error?: string
}

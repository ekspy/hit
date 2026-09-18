import Anthropic from '@anthropic-ai/sdk'
import type { MessageCreateParamsNonStreaming, MessageParam, Message, Tool } from '@anthropic-ai/sdk/resources/messages/messages'

import type { ChatRequest, ChatResponse, LlmProvider, ModelId, ToolCall } from './types.js'

/** Minimal surface of the SDK we depend on, so tests can inject a mock. */
export interface AnthropicLike {
  messages: { create(params: MessageCreateParamsNonStreaming): Promise<Message> }
}

export class AnthropicProvider implements LlmProvider {
  private readonly client: AnthropicLike

  constructor(
    readonly model: ModelId = 'claude-sonnet-5',
    client?: AnthropicLike,
  ) {
    // Zero-config client: picks up ANTHROPIC_API_KEY or the OAuth profile in ~/.anthropic.
    // Retries and timeouts are handled by our own wrapper (see retry.ts).
    this.client = client ?? new Anthropic({ maxRetries: 0, timeout: 120_000 })
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const params = toAnthropicParams(this.model, request)
    const started = performance.now()
    const message = await this.client.messages.create(params)
    return parseAnthropicMessage(message, performance.now() - started)
  }
}

export function toAnthropicParams(model: string, request: ChatRequest): MessageCreateParamsNonStreaming {
  const tools: Tool[] = request.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters as Tool.InputSchema,
  }))
  const messages: MessageParam[] = request.messages.map((message) => {
    if (message.role === 'user') {
      return { role: 'user', content: [{ type: 'text', text: message.text }] }
    }
    if (message.role === 'assistant') {
      // Echo back the original content blocks when available so thinking blocks stay intact.
      if (message.raw && Array.isArray(message.raw)) {
        return { role: 'assistant', content: message.raw as MessageParam['content'] }
      }
      const content: Array<Anthropic.Messages.ContentBlockParam> = []
      if (message.text) {
        content.push({ type: 'text', text: message.text })
      }
      for (const call of message.toolCalls) {
        content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.args })
      }
      return { role: 'assistant', content }
    }
    return {
      role: 'user',
      content: message.results.map((result) => ({
        type: 'tool_result',
        tool_use_id: result.callId,
        content: result.output,
        is_error: result.isError ?? false,
      })),
    }
  })

  return {
    model,
    max_tokens: 8_192,
    system: request.system,
    messages,
    tools,
    // Thinking is adaptive by default on this model; `thinking`, `temperature` and `top_p` are intentionally omitted.
    output_config: { effort: 'medium' },
  }
}

export function parseAnthropicMessage(message: Message, latencyMs: number): ChatResponse {
  const text = message.content
    .filter((block): block is Anthropic.Messages.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
  const toolCalls: ToolCall[] = message.content
    .filter((block): block is Anthropic.Messages.ToolUseBlock => block.type === 'tool_use')
    .map((block) => ({ id: block.id, name: block.name, args: (block.input ?? {}) as Record<string, unknown> }))

  return {
    text,
    toolCalls,
    usage: {
      input: message.usage.input_tokens + (message.usage.cache_creation_input_tokens ?? 0) + (message.usage.cache_read_input_tokens ?? 0),
      output: message.usage.output_tokens,
    },
    latencyMs,
    raw: message.content,
    stopReason: message.stop_reason ?? undefined,
  }
}

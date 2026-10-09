import OpenAI from 'openai'
import type { FunctionTool, Response, ResponseCreateParamsNonStreaming, ResponseInputItem } from 'openai/resources/responses/responses'

import type { ChatRequest, ChatResponse, LlmProvider, ModelId, ToolCall } from './types.js'

export interface OpenAILike {
  responses: { create(params: ResponseCreateParamsNonStreaming): Promise<Response> }
}

export class OpenAIProvider implements LlmProvider {
  private readonly client: OpenAILike

  constructor(
    readonly model: ModelId = 'gpt-5.6-terra',
    client?: OpenAILike,
  ) {
    this.client = client ?? new OpenAI({ maxRetries: 0, timeout: 120_000 })
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const params = toOpenAIParams(this.model, request)
    const started = performance.now()
    const response = await this.client.responses.create(params)
    return parseOpenAIResponse(response, performance.now() - started)
  }
}

export function toOpenAIParams(model: string, request: ChatRequest): ResponseCreateParamsNonStreaming {
  const tools: FunctionTool[] = request.tools.map((tool) => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    strict: false,
  }))
  const input: ResponseInputItem[] = []

  for (const message of request.messages) {
    if (message.role === 'user') {
      input.push({ role: 'user', content: message.text })
    } else if (message.role === 'assistant') {
      // Replay the full output item list (reasoning items + messages + function calls) so the model keeps its context.
      if (Array.isArray(message.raw)) {
        input.push(...(message.raw as ResponseInputItem[]))
      } else {
        if (message.text) {
          input.push({ role: 'assistant', content: message.text })
        }
        for (const call of message.toolCalls) {
          input.push({ type: 'function_call', call_id: call.id, name: call.name, arguments: JSON.stringify(call.args) })
        }
      }
    } else {
      for (const result of message.results) {
        input.push({ type: 'function_call_output', call_id: result.callId, output: result.output })
      }
    }
  }

  return {
    model,
    instructions: request.system,
    input,
    tools,
    store: false,
    include: ['reasoning.encrypted_content'],
  }
}

export function parseOpenAIResponse(response: Response, latencyMs: number): ChatResponse {
  const toolCalls: ToolCall[] = []
  const texts: string[] = []

  for (const item of response.output) {
    if (item.type === 'function_call') {
      toolCalls.push({ id: item.call_id, name: item.name, args: safeJson(item.arguments) })
    } else if (item.type === 'message') {
      for (const part of item.content) {
        if (part.type === 'output_text') {
          texts.push(part.text)
        }
      }
    }
  }

  return {
    text: texts.join('\n'),
    toolCalls,
    usage: { input: response.usage?.input_tokens ?? 0, output: response.usage?.output_tokens ?? 0 },
    latencyMs,
    raw: response.output,
    stopReason: response.status ?? undefined,
    modelSnapshot: response.model,
  }
}

function safeJson(text: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(text)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

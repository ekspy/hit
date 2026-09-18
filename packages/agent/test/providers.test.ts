import { describe, expect, it } from 'vitest'

import {
  AnthropicProvider,
  GoogleProvider,
  LoggingProvider,
  OpenAIProvider,
  costUsd,
  toAnthropicParams,
  toGoogleParams,
  toOpenAIParams,
  withRetry,
  type ChatRequest,
} from '../src/index.js'

const request: ChatRequest = {
  system: 'sys',
  tools: [{ name: 'read_file', description: 'read', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } }],
  messages: [
    { role: 'user', text: 'hello' },
    { role: 'assistant', text: 'reading', toolCalls: [{ id: 'c1', name: 'read_file', args: { path: 'a.ts' } }] },
    { role: 'tool', results: [{ callId: 'c1', name: 'read_file', output: 'content' }] },
  ],
}

describe('AnthropicProvider', () => {
  it('builds params without thinking/temperature and parses tool_use blocks', async () => {
    let seen: unknown
    const provider = new AnthropicProvider('claude-sonnet-5', {
      messages: {
        async create(params) {
          seen = params
          return {
            id: 'm', type: 'message', role: 'assistant', model: 'claude-sonnet-5', stop_sequence: null, stop_reason: 'tool_use',
            content: [
              { type: 'text', text: 'Let me edit.', citations: null },
              { type: 'tool_use', id: 'tu1', name: 'edit_file', input: { path: 'a.ts', search: 'x', replace: 'y' }, caller: { type: 'direct' } },
            ],
            usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 5, cache_read_input_tokens: 10, cache_creation: null, inference_geo: null, server_tool_use: null, service_tier: null } as never,
          } as never
        },
      },
    })
    const response = await provider.chat(request)
    const params = seen as Record<string, unknown>
    expect(params.model).toBe('claude-sonnet-5')
    expect(params.output_config).toEqual({ effort: 'medium' })
    expect(params).not.toHaveProperty('thinking')
    expect(params).not.toHaveProperty('temperature')
    expect((params.tools as Array<{ name: string }>)[0]?.name).toBe('read_file')
    const messages = params.messages as Array<{ role: string; content: Array<{ type: string }> }>
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    expect(messages[2]?.content[0]?.type).toBe('tool_result')
    expect(response.text).toBe('Let me edit.')
    expect(response.toolCalls).toEqual([{ id: 'tu1', name: 'edit_file', args: { path: 'a.ts', search: 'x', replace: 'y' } }])
    expect(response.usage).toEqual({ input: 115, output: 20 })
  })

  it('replays raw content blocks for assistant turns', () => {
    const raw = [{ type: 'text', text: 'kept' }]
    const params = toAnthropicParams('claude-sonnet-5', { ...request, messages: [{ role: 'assistant', text: 'kept', toolCalls: [], raw }] })
    expect(params.messages[0]?.content).toBe(raw)
  })
})

describe('OpenAIProvider', () => {
  it('uses the Responses API with function tools and parses function_call items', async () => {
    let seen: unknown
    const provider = new OpenAIProvider('gpt-5.6-terra', {
      responses: {
        async create(params) {
          seen = params
          return {
            output: [
              { type: 'reasoning', id: 'r1', summary: [] },
              { type: 'message', id: 'm1', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'ok', annotations: [] }] },
              { type: 'function_call', call_id: 'fc1', name: 'read_file', arguments: '{"path":"a.ts"}' },
            ],
            usage: { input_tokens: 50, output_tokens: 7 },
            status: 'completed',
          } as never
        },
      },
    })
    const response = await provider.chat(request)
    const params = seen as Record<string, unknown>
    expect(params.model).toBe('gpt-5.6-terra')
    expect(params.instructions).toBe('sys')
    expect((params.tools as Array<{ type: string; name: string }>)[0]).toMatchObject({ type: 'function', name: 'read_file' })
    const input = params.input as Array<Record<string, unknown>>
    expect(input.map((item) => item.type ?? item.role)).toEqual(['user', 'assistant', 'function_call', 'function_call_output'])
    expect(response.text).toBe('ok')
    expect(response.toolCalls).toEqual([{ id: 'fc1', name: 'read_file', args: { path: 'a.ts' } }])
    expect(response.usage).toEqual({ input: 50, output: 7 })
    expect(Array.isArray(response.raw)).toBe(true)
  })

  it('replays raw output items (reasoning included) on the next turn', () => {
    const raw = [{ type: 'reasoning', id: 'r1', summary: [] }, { type: 'function_call', call_id: 'x', name: 'done', arguments: '{}' }]
    const params = toOpenAIParams('gpt-5.6-terra', { ...request, messages: [{ role: 'assistant', text: '', toolCalls: [], raw }] })
    expect(params.input).toEqual(raw)
  })
})

describe('GoogleProvider', () => {
  it('sends function declarations and parses functionCall parts and thoughts tokens', async () => {
    let seen: unknown
    const provider = new GoogleProvider('gemini-3.1-pro-preview', {
      models: {
        async generateContent(params) {
          seen = params
          return {
            candidates: [
              {
                content: { role: 'model', parts: [{ text: 'thinking', thought: true }, { text: 'edit' }, { functionCall: { name: 'read_file', args: { path: 'a.ts' } }, thoughtSignature: 'sig' }] },
                finishReason: 'STOP',
              },
            ],
            usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 4, thoughtsTokenCount: 6 },
          } as never
        },
      },
    })
    const response = await provider.chat(request)
    const params = seen as { model: string; contents: Array<{ role: string; parts: Array<Record<string, unknown>> }>; config: Record<string, unknown> }
    expect(params.model).toBe('gemini-3.1-pro-preview')
    expect(params.config.systemInstruction).toBe('sys')
    expect(params.contents.map((content) => content.role)).toEqual(['user', 'model', 'user'])
    expect(params.contents[2]?.parts[0]).toHaveProperty('functionResponse')
    expect(response.text).toBe('edit')
    expect(response.toolCalls).toEqual([{ id: 'call_1', name: 'read_file', args: { path: 'a.ts' } }])
    expect(response.usage).toEqual({ input: 30, output: 10 })
  })

  it('replays the model content verbatim to preserve thought signatures', () => {
    const raw = { role: 'model', parts: [{ functionCall: { name: 'done', args: {} }, thoughtSignature: 'sig' }] }
    const params = toGoogleParams('gemini-3.1-pro-preview', { ...request, messages: [{ role: 'assistant', text: '', toolCalls: [], raw }] })
    expect((params.contents as unknown[])[0]).toBe(raw)
  })
})

describe('LoggingProvider and retries', () => {
  it('retries on 429 with backoff and logs usage, latency and cost', async () => {
    let calls = 0
    const inner = {
      model: 'gpt-5.6-terra' as const,
      async chat() {
        calls += 1
        if (calls < 3) {
          throw Object.assign(new Error('rate limited'), { status: 429 })
        }
        return { text: 'done', toolCalls: [], usage: { input: 1_000_000, output: 1_000_000 }, latencyMs: 12 }
      },
    }
    const provider = new LoggingProvider(inner, { sleep: async () => undefined })
    const response = await provider.chat(request)
    expect(response.text).toBe('done')
    expect(calls).toBe(3)
    expect(provider.logs).toHaveLength(1)
    expect(provider.logs[0]).toMatchObject({ model: 'gpt-5.6-terra', attempts: 3, costUsd: 14, usage: { input: 1_000_000, output: 1_000_000 } })
  })

  it('does not retry on 400 and records the error', async () => {
    let calls = 0
    const provider = new LoggingProvider(
      {
        model: 'gemini-3.1-pro-preview',
        async chat() {
          calls += 1
          throw Object.assign(new Error('bad request'), { status: 400 })
        },
      },
      { sleep: async () => undefined },
    )
    await expect(provider.chat(request)).rejects.toThrow('bad request')
    expect(calls).toBe(1)
    expect(provider.logs[0]?.error).toBe('bad request')
  })

  it('gives up after the configured retries', async () => {
    let calls = 0
    await expect(
      withRetry(
        async () => {
          calls += 1
          throw Object.assign(new Error('boom'), { status: 503 })
        },
        { retries: 3, sleep: async () => undefined },
      ),
    ).rejects.toThrow('boom')
    expect(calls).toBe(4)
  })

  it('computes cost from the price table', () => {
    expect(costUsd('claude-sonnet-5', { input: 500_000, output: 100_000 })).toBeCloseTo(2)
  })
})

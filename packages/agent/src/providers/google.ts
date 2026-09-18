import { GoogleGenAI, type Content, type FunctionDeclaration, type GenerateContentParameters, type GenerateContentResponse, type Part } from '@google/genai'

import type { ChatRequest, ChatResponse, LlmProvider, ModelId, ToolCall } from './types.js'

export interface GoogleLike {
  models: { generateContent(params: GenerateContentParameters): Promise<GenerateContentResponse> }
}

export class GoogleProvider implements LlmProvider {
  private readonly client: GoogleLike

  constructor(
    readonly model: ModelId = 'gemini-3.1-pro-preview',
    client?: GoogleLike,
  ) {
    this.client =
      client ??
      new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY,
        httpOptions: { timeout: 120_000, retryOptions: { attempts: 1 } },
      })
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const params = toGoogleParams(this.model, request)
    const started = performance.now()
    const response = await this.client.models.generateContent(params)
    return parseGoogleResponse(response, performance.now() - started)
  }
}

export function toGoogleParams(model: string, request: ChatRequest): GenerateContentParameters {
  const functionDeclarations: FunctionDeclaration[] = request.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parametersJsonSchema: tool.parameters,
  }))
  const contents: Content[] = []

  for (const message of request.messages) {
    if (message.role === 'user') {
      contents.push({ role: 'user', parts: [{ text: message.text }] })
    } else if (message.role === 'assistant') {
      // Replay the model's own parts verbatim so thought signatures are preserved.
      if (message.raw && typeof message.raw === 'object' && Array.isArray((message.raw as Content).parts)) {
        contents.push(message.raw as Content)
      } else {
        const parts: Part[] = []
        if (message.text) {
          parts.push({ text: message.text })
        }
        for (const call of message.toolCalls) {
          parts.push({ functionCall: { id: call.id, name: call.name, args: call.args } })
        }
        contents.push({ role: 'model', parts })
      }
    } else {
      contents.push({
        role: 'user',
        parts: message.results.map((result) => ({
          functionResponse: {
            id: result.callId || undefined,
            name: result.name,
            response: result.isError ? { error: result.output } : { output: result.output },
          },
        })),
      })
    }
  }

  return {
    model,
    contents,
    config: {
      systemInstruction: request.system,
      tools: [{ functionDeclarations }],
    },
  }
}

export function parseGoogleResponse(response: GenerateContentResponse, latencyMs: number): ChatResponse {
  const candidate = response.candidates?.[0]
  const parts = candidate?.content?.parts ?? []
  const texts: string[] = []
  const toolCalls: ToolCall[] = []
  let counter = 0

  for (const part of parts) {
    if (part.functionCall) {
      counter += 1
      toolCalls.push({
        id: part.functionCall.id ?? `call_${counter}`,
        name: part.functionCall.name ?? '',
        args: part.functionCall.args ?? {},
      })
    } else if (part.text && !part.thought) {
      texts.push(part.text)
    }
  }

  const usage = response.usageMetadata
  return {
    text: texts.join('\n'),
    toolCalls,
    usage: {
      input: usage?.promptTokenCount ?? 0,
      output: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
    },
    latencyMs,
    raw: candidate?.content,
    stopReason: candidate?.finishReason ? String(candidate.finishReason) : undefined,
  }
}

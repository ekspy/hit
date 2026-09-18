import { existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

import { AnthropicProvider } from './anthropic.js'
import { GoogleProvider } from './google.js'
import { LoggingProvider } from './logging.js'
import { OpenAIProvider } from './openai.js'
import { MODELS, type LlmProvider, type ModelId } from './types.js'

export * from './types.js'
export { AnthropicProvider, parseAnthropicMessage, toAnthropicParams, type AnthropicLike } from './anthropic.js'
export { OpenAIProvider, parseOpenAIResponse, toOpenAIParams, type OpenAILike } from './openai.js'
export { GoogleProvider, parseGoogleResponse, toGoogleParams, type GoogleLike } from './google.js'
export { LoggingProvider, type CallListener } from './logging.js'
export { withRetry, withTimeout, isRetryable, errorStatus, LlmTimeoutError, type RetryOptions } from './retry.js'

export function isModelId(value: string): value is ModelId {
  return (MODELS as readonly string[]).includes(value)
}

/** Returns a reason the model cannot run (missing credentials), or undefined when it is available. */
export function modelUnavailableReason(model: ModelId): string | undefined {
  switch (model) {
    case 'claude-sonnet-5': {
      const configDirs = [
        process.env.ANTHROPIC_CONFIG_DIR,
        path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'anthropic'),
        path.join(os.homedir(), '.anthropic'),
      ].filter((dir): dir is string => Boolean(dir))
      if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || configDirs.some((dir) => existsSync(path.join(dir, 'credentials')))) {
        return undefined
      }
      return 'ANTHROPIC_API_KEY is unset and no OAuth profile (credentials) was found under ~/.config/anthropic or ~/.anthropic'
    }
    case 'gpt-5.6-terra':
      return process.env.OPENAI_API_KEY ? undefined : 'OPENAI_API_KEY is unset'
    case 'gemini-3.1-pro-preview':
      return process.env.GEMINI_API_KEY ? undefined : 'GEMINI_API_KEY is unset'
  }
}

export function createProvider(model: ModelId): LoggingProvider {
  let inner: LlmProvider
  switch (model) {
    case 'claude-sonnet-5':
      inner = new AnthropicProvider(model)
      break
    case 'gpt-5.6-terra':
      inner = new OpenAIProvider(model)
      break
    case 'gemini-3.1-pro-preview':
      inner = new GoogleProvider(model)
      break
  }
  return new LoggingProvider(inner)
}

import type { Agent, AgentAction, AgentContext, SemanticEvent, Subscription, TaskAgent } from '@hit/coordinator'

import type { ChatMessage, LlmProvider, ToolCall, Usage } from './providers/types.js'
import { costUsd } from './providers/types.js'
import { AGENT_TOOLS, executeTool } from './tools.js'
import type { Workspace } from './workspace.js'

export const DEFAULT_MAX_TURNS = 12

export interface LlmAgentOptions {
  id: string
  provider: LlmProvider
  workspace: Workspace
  /** Files this agent is responsible for (named in the prompt). */
  ownFiles?: string[]
  /** Files owned by other agents; edit_file refuses them. */
  readOnlyFiles?: string[]
  maxTurns?: number
  subscriptions?: Subscription[]
  log?: (line: string) => void
}

export interface ToolCallRecord {
  name: string
  args: Record<string, unknown>
  output: string
  isError: boolean
}

export interface TurnRecord {
  turn: number
  injectedEvents?: SemanticEvent[]
  userMessage?: string
  assistantText: string
  toolCalls: ToolCallRecord[]
  usage: Usage
  latencyMs: number
  costUsd: number
  error?: string
}

export type SessionKind = 'repair' | 'task' | 'late-repair'

export interface SessionResult {
  kind: SessionKind
  system: string
  turns: number
  edits: number
  done: boolean
  summary?: string
  usage: Usage
  costUsd: number
  latenciesMs: number[]
  turnRecords: TurnRecord[]
  error?: string
}

interface SessionState extends SessionResult {
  messages: ChatMessage[]
  idleTurns: number
}

/**
 * Real LLM agent. Works on its own Workspace (its replica) through five tools; supports the
 * event-driven repair entry point (Mode 1), the long-running task entry point (Mode 2) and a
 * post-merge "late diagnostics" repair round (git baseline).
 */
export class LlmAgent implements Agent, TaskAgent {
  readonly id: string
  readonly subscriptions: Subscription[]
  readonly sessions: SessionResult[] = []
  private readonly provider: LlmProvider
  private readonly workspace: Workspace
  private readonly ownFiles: string[]
  private readonly readOnlyFiles: string[]
  private readonly maxTurns: number
  private readonly log: (line: string) => void
  private pendingEvents: SemanticEvent[] = []
  private current: SessionState | undefined

  constructor(options: LlmAgentOptions) {
    this.id = options.id
    this.provider = options.provider
    this.workspace = options.workspace
    this.ownFiles = options.ownFiles ?? []
    this.readOnlyFiles = options.readOnlyFiles ?? []
    this.maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS
    this.subscriptions = options.subscriptions ?? [{ type: '*' }]
    this.log = options.log ?? (() => undefined)
  }

  get model(): string {
    return this.provider.model
  }

  // ---- Mode 1: event-driven repair -------------------------------------------------------

  async onEvent(ctx: AgentContext): Promise<AgentAction[]> {
    return this.onEvents({ ...ctx, events: [ctx.event] })
  }

  async onEvents(ctx: Omit<AgentContext, 'event'> & { events: SemanticEvent[] }): Promise<AgentAction[]> {
    await this.runRepair(ctx.events)
    const session = this.sessions.at(-1)
    return [{ kind: 'noop', note: `${this.id} applied ${session?.edits ?? 0} edit(s) directly on its replica` }]
  }

  async runRepair(events: SemanticEvent[]): Promise<SessionResult> {
    this.beginSession('repair', repairSystemPrompt(this.ownFiles, this.readOnlyFiles), `${eventsMessage(events)}\n\n${fileListing(this.workspace)}`, events)
    return this.runToCompletion()
  }

  // ---- Mode 2: natural-language task -----------------------------------------------------

  beginTask(task: string): void {
    this.beginSession('task', taskSystemPrompt(this.ownFiles, this.readOnlyFiles), `Task: ${task}\n\n${fileListing(this.workspace)}`)
  }

  async runTask(task: string): Promise<SessionResult> {
    this.beginTask(task)
    return this.runToCompletion()
  }

  pushEvents(events: SemanticEvent[]): void {
    this.pendingEvents.push(...events)
  }

  taskDone(): boolean {
    return this.current === undefined || this.current.done || this.current.turns >= this.maxTurns
  }

  // ---- git baseline: one repair round after the merge ------------------------------------

  async runLateRepair(diagnosticsText: string, mergeNote = ''): Promise<SessionResult> {
    const intro = `Your branch has just been merged with concurrent work from another agent.${mergeNote ? ` ${mergeNote}` : ''} The merged tree does not type-check. Fix it (you may also update tests you own so they reflect the merged contract).`
    this.beginSession('late-repair', repairSystemPrompt(this.ownFiles, this.readOnlyFiles), `${intro}\n\nTypecheck output:\n${diagnosticsText}\n\n${fileListing(this.workspace)}`)
    return this.runToCompletion()
  }

  // ---- turn loop ---------------------------------------------------------------------------

  async nextTurn(): Promise<'continue' | 'done'> {
    const session = this.current
    if (!session || session.done) {
      return 'done'
    }
    if (session.turns >= this.maxTurns) {
      this.finish(session, false)
      return 'done'
    }

    const record: TurnRecord = {
      turn: session.turns + 1,
      assistantText: '',
      toolCalls: [],
      usage: { input: 0, output: 0 },
      latencyMs: 0,
      costUsd: 0,
    }

    if (this.pendingEvents.length > 0) {
      const events = this.pendingEvents.splice(0)
      const text = `[hit] impact event(s) from concurrent work by another agent just arrived in your replica:\n${eventsMessage(events)}\nReconcile your work with these changes (re-read affected files before editing) and continue your task.`
      session.messages.push({ role: 'user', text })
      record.injectedEvents = events
      record.userMessage = text
    }

    session.turns += 1
    let response
    try {
      response = await this.provider.chat({ system: session.system, messages: session.messages, tools: AGENT_TOOLS })
    } catch (error) {
      record.error = error instanceof Error ? error.message : String(error)
      session.turnRecords.push(record)
      session.error = record.error
      this.finish(session, false)
      return 'done'
    }

    record.assistantText = response.text
    record.usage = response.usage
    record.latencyMs = response.latencyMs
    record.costUsd = costUsd(this.provider.model, response.usage)
    session.usage = { input: session.usage.input + response.usage.input, output: session.usage.output + response.usage.output }
    session.costUsd += record.costUsd
    session.latenciesMs.push(response.latencyMs)
    session.messages.push({ role: 'assistant', text: response.text, toolCalls: response.toolCalls, raw: response.raw })
    this.log(`[${this.id}/${this.provider.model}] turn ${record.turn}: ${response.toolCalls.map((call) => call.name).join(', ') || '(no tool call)'} in ${Math.round(response.latencyMs)} ms`)

    if (response.toolCalls.length === 0) {
      session.idleTurns += 1
      session.turnRecords.push(record)
      if (session.idleTurns >= 2) {
        this.finish(session, false)
        return 'done'
      }
      session.messages.push({ role: 'user', text: 'Please continue using the tools. When the work is complete, call `done` with a summary.' })
      return 'continue'
    }

    session.idleTurns = 0
    const results = response.toolCalls.map((call) => this.execute(session, call, record))
    session.messages.push({ role: 'tool', results })
    session.turnRecords.push(record)

    if (session.done) {
      return 'done'
    }
    if (session.turns >= this.maxTurns) {
      this.finish(session, false)
      return 'done'
    }
    return 'continue'
  }

  private execute(session: SessionState, call: ToolCall, record: TurnRecord) {
    const execution = executeTool(this.workspace, call.name, call.args, { readOnlyFiles: this.readOnlyFiles })
    record.toolCalls.push({ name: call.name, args: call.args, output: execution.output, isError: execution.isError })
    if (execution.edited) {
      session.edits += 1
    }
    if (execution.done !== undefined) {
      session.summary = execution.done
      this.finish(session, true)
    }
    return { callId: call.id, name: call.name, output: execution.output, isError: execution.isError }
  }

  private async runToCompletion(): Promise<SessionResult> {
    while ((await this.nextTurn()) === 'continue') {
      // keep looping
    }
    return this.sessions.at(-1)!
  }

  private beginSession(kind: SessionKind, system: string, firstUser: string, injectedEvents?: SemanticEvent[]): void {
    this.pendingEvents = []
    this.current = {
      kind,
      system,
      turns: 0,
      edits: 0,
      done: false,
      usage: { input: 0, output: 0 },
      costUsd: 0,
      latenciesMs: [],
      turnRecords: [],
      messages: [{ role: 'user', text: firstUser }],
      idleTurns: 0,
    }
    // Keep the first user message visible in the transcript.
    this.current.turnRecords.push({ turn: 0, userMessage: firstUser, injectedEvents, assistantText: '', toolCalls: [], usage: { input: 0, output: 0 }, latencyMs: 0, costUsd: 0 })
  }

  private finish(session: SessionState, done: boolean): void {
    if (this.sessions.includes(session)) {
      session.done = session.done || done
      return
    }
    session.done = done
    const { messages: _messages, idleTurns: _idle, ...result } = session
    this.sessions.push(result)
    this.current = session
  }
}

// ---- prompt helpers ------------------------------------------------------------------------

function ownershipText(ownFiles: string[], readOnlyFiles: string[]): string {
  const parts: string[] = []
  if (ownFiles.length > 0) {
    parts.push(`You own these files: ${ownFiles.join(', ')}.`)
  }
  if (readOnlyFiles.length > 0) {
    parts.push(`These files belong to another agent and must not be edited: ${readOnlyFiles.join(', ')}.`)
  }
  return parts.join(' ')
}

const TOOL_RULES = `Rules:
- Use the tools; do not answer with prose only. Read a file before editing it.
- edit_file replaces exactly one occurrence of \`search\`; copy the text verbatim from read_file output. If it fails, re-read the file and retry with a smaller, unique snippet.
- Run run_typecheck before finishing; it must report 0 diagnostics. Tests that encode the old contract may be updated to match the new one.
- Do not create new files or reformat unrelated code. Keep changes minimal.
- Finish by calling done with a short summary.`

export function repairSystemPrompt(ownFiles: string[], readOnlyFiles: string[]): string {
  return `You are a software engineer working on a small TypeScript project shared with other agents through a replicated repository. ${ownershipText(ownFiles, readOnlyFiles)}
A concurrent change made by another agent impacted code you own. Repair your code so the project type-checks and behaves sensibly under the new contract.
${TOOL_RULES}`
}

export function taskSystemPrompt(ownFiles: string[], readOnlyFiles: string[]): string {
  return `You are a software engineer working on a small TypeScript project shared with other agents through a replicated repository. ${ownershipText(ownFiles, readOnlyFiles)}
Implement the task you are given. Other agents may change other files concurrently; if you receive an "[hit] impact event" message, reconcile your work with the change before continuing.
${TOOL_RULES}`
}

function fileListing(workspace: Workspace): string {
  return `Files in the repository:\n${workspace.listFiles().join('\n')}`
}

export function serializeEvent(event: SemanticEvent): string {
  switch (event.type) {
    case 'symbol_signature_changed':
      return `- symbol_signature_changed: ${event.symbolId}\n    before: ${event.from}\n    after:  ${event.to}\n    consumers: ${event.consumers.join(', ')}`
    case 'symbol_removed':
      return `- symbol_removed: ${event.symbolId}\n    consumers: ${event.consumers.join(', ')}`
    case 'consumer_impacted':
    case 'test_invalidated': {
      const conflict = event.conflict
      const affected = conflict.affected.map((item) => `${item.file}${item.loc ? `:${item.loc.line}:${item.loc.column}` : ''}${item.symbolId ? ` (${item.symbolId})` : ''}`).join(', ')
      return `- ${event.type} [rule ${conflict.rule}, severity ${conflict.severity}]: origin ${conflict.origin.file}${conflict.origin.symbolId ? ` (${conflict.origin.symbolId})` : ''}\n    affected: ${affected}\n    reason: ${conflict.reason}`
    }
  }
}

export function eventsMessage(events: SemanticEvent[]): string {
  return `Impact events (${events.length}):\n${events.map(serializeEvent).join('\n')}`
}

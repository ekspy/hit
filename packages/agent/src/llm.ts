import type { Agent, AgentAction, AgentContext, SemanticEvent, Subscription } from '@hit/coordinator'

export interface LlmPrompt {
  agentId: string
  event: SemanticEvent
  files: string[]
}

export class LlmAgent implements Agent {
  readonly subscriptions: Subscription[] = [{ type: '*' }]
  prompts: LlmPrompt[] = []

  constructor(readonly id: string) {}

  buildPrompt(ctx: AgentContext): LlmPrompt {
    return {
      agentId: this.id,
      event: ctx.event,
      files: ctx.repo.listFiles(),
    }
  }

  parseToolCalls(json: string): AgentAction[] {
    const parsed: unknown = JSON.parse(json)

    if (!Array.isArray(parsed)) {
      throw new Error('LLM tool call payload must be an array')
    }

    return parsed.map(parseAction)
  }

  async onEvent(ctx: AgentContext): Promise<AgentAction[]> {
    this.prompts.push(this.buildPrompt(ctx))
    return [{ kind: 'noop', note: 'LLM provider calls are disabled in the preliminary prototype' }]
  }
}

function parseAction(value: unknown): AgentAction {
  if (!value || typeof value !== 'object' || !('kind' in value)) {
    throw new Error('Invalid action')
  }

  const action = value as AgentAction

  if (action.kind === 'edit_file' && (!action.path || action.edit.start < 0 || action.edit.deleteCount < 0)) {
    throw new Error('Invalid edit_file action')
  }

  if (action.kind === 'claim_task' && !action.taskId) {
    throw new Error('Invalid claim_task action')
  }

  if (action.kind === 'release_claim' && (!action.taskId || !action.proposalId)) {
    throw new Error('Invalid release_claim action')
  }

  if (action.kind === 'noop' && !action.note) {
    throw new Error('Invalid noop action')
  }

  return action
}

import type { Agent, AgentAction, AgentContext, SemanticEvent, Subscription } from '@hit/coordinator'

export interface ReplacementRule {
  eventType: SemanticEvent['type'] | '*'
  path: string
  search: string
  replace: string
  once?: boolean
}

export class ScriptedAgent implements Agent {
  private applied = new Set<string>()

  constructor(
    readonly id: string,
    readonly subscriptions: Subscription[],
    private readonly rules: ReplacementRule[],
  ) {}

  async onEvent(ctx: AgentContext): Promise<AgentAction[]> {
    const actions: AgentAction[] = []

    for (const rule of this.rules) {
      const key = `${rule.path}:${rule.search}:${rule.replace}`

      if (rule.once && this.applied.has(key)) {
        continue
      }

      if (rule.eventType !== '*' && rule.eventType !== ctx.event.type) {
        continue
      }

      const content = ctx.repo.fileContent(rule.path)
      const start = content.indexOf(rule.search)

      if (start === -1) {
        continue
      }

      actions.push({
        kind: 'edit_file',
        path: rule.path,
        edit: {
          start,
          deleteCount: rule.search.length,
          insert: rule.replace,
        },
      })
      this.applied.add(key)
    }

    return actions.length > 0 ? actions : [{ kind: 'noop', note: `${this.id} had no scripted reaction` }]
  }
}

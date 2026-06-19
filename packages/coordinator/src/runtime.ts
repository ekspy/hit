import { ImpactEngine, type Conflict } from '@hit/impact-engine'
import { Repo } from '@hit/repo-crdt'
import { SemanticIndex, semanticDiff } from '@hit/semantic-indexer'

import { eventMatches, type Agent, type AgentAction, type SemanticEvent } from './events.js'
import { eventsFromDiffAndConflicts } from './watcher.js'

export interface StepReport {
  step: number
  events: SemanticEvent[]
  conflicts: Conflict[]
  actions: Array<{ agentId: string; action: AgentAction }>
}

export interface RunReport {
  steps: StepReport[]
  finalConflicts: Conflict[]
}

export class Runtime {
  private previousIndex: SemanticIndex
  private stepNumber = 0
  private readonly impact = new ImpactEngine()

  constructor(
    private readonly repo: Repo,
    private readonly agents: Agent[],
  ) {
    this.previousIndex = SemanticIndex.build(repo)
  }

  async step(): Promise<StepReport> {
    this.stepNumber += 1
    const currentIndex = SemanticIndex.build(this.repo)
    const diff = semanticDiff(this.previousIndex, currentIndex)
    const conflicts = this.impact.analyze(diff, currentIndex)
    const events = eventsFromDiffAndConflicts(diff, currentIndex, conflicts)
    const actions: Array<{ agentId: string; action: AgentAction }> = []

    for (const event of events) {
      for (const agent of this.agents) {
        if (!agent.subscriptions.some((subscription) => eventMatches(subscription, event))) {
          continue
        }

        const returned = await agent.onEvent({
          repo: this.repo,
          index: currentIndex,
          event,
          myClaims: [],
        })

        for (const action of returned) {
          this.applyAction(action)
          actions.push({ agentId: agent.id, action })
        }
      }
    }

    this.previousIndex = currentIndex

    return {
      step: this.stepNumber,
      events,
      conflicts,
      actions,
    }
  }

  async run(maxSteps: number): Promise<RunReport> {
    const steps: StepReport[] = []

    for (let index = 0; index < maxSteps; index += 1) {
      const step = await this.step()
      steps.push(step)

      if (step.events.length === 0 && step.actions.length === 0) {
        break
      }
    }

    const finalIndex = SemanticIndex.build(this.repo)
    return {
      steps,
      finalConflicts: this.impact.analyze(semanticDiff(this.previousIndex, finalIndex), finalIndex),
    }
  }

  private applyAction(action: AgentAction): void {
    if (action.kind === 'edit_file') {
      this.repo.editFile(action.path, action.edit)
      return
    }

    if (action.kind === 'claim_task') {
      this.repo.claimTask(action.taskId)
      return
    }

    if (action.kind === 'release_claim') {
      this.repo.releaseClaim(action.taskId, action.proposalId)
    }
  }
}

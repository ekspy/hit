import { ImpactEngine, type Conflict } from '@hit/impact-engine'
import type { Repo } from '@hit/repo-crdt'
import { SemanticIndex, semanticDiff } from '@hit/semantic-indexer'

import { eventKey, eventMatches, type Agent, type AgentAction, type AgentContext, type SemanticEvent } from './events.js'
import { eventsFromDiffAndConflicts } from './watcher.js'

/** Agents that prefer receiving all events of a step at once (one repair session instead of one per event). */
export interface BatchAgent extends Agent {
  onEvents(ctx: Omit<AgentContext, 'event'> & { events: SemanticEvent[] }): Promise<AgentAction[]>
}

/** Agents that run a long-lived task turn by turn (Mode 2). Events pushed between turns are injected before the next turn. */
export interface TaskAgent extends Agent {
  nextTurn(): Promise<'continue' | 'done'>
  pushEvents(events: SemanticEvent[]): void
  taskDone(): boolean
}

export interface Member {
  id: string
  repo: Repo
  agent?: Agent
}

export interface MemberStepReport {
  memberId: string
  events: SemanticEvent[]
  conflicts: Conflict[]
  actions: AgentAction[]
}

export interface MultiStepReport {
  step: number
  members: MemberStepReport[]
}

export interface TaskRoundReport {
  round: number
  turns: Array<{ memberId: string; result: 'continue' | 'done' | 'idle'; deliveredTo: Array<{ memberId: string; events: SemanticEvent[] }> }>
}

export function isBatchAgent(agent: Agent): agent is BatchAgent {
  return typeof (agent as BatchAgent).onEvents === 'function'
}

export function isTaskAgent(agent: Agent): agent is TaskAgent {
  return typeof (agent as TaskAgent).nextTurn === 'function'
}

/**
 * One Repo replica per agent. Changes travel only through `Repo.syncWith`; the index, diff and
 * conflicts are computed on each replica separately, and each agent only ever sees events derived
 * from changes that arrived at its own replica from elsewhere (its own edits are never reported back).
 */
export class MultiReplicaRuntime {
  private readonly lastSeen = new Map<string, SemanticIndex>()
  private readonly impact = new ImpactEngine()
  private stepNumber = 0
  readonly eventsDelivered: Array<{ memberId: string; events: SemanticEvent[] }> = []
  /** Event keys already delivered to each member: a persistent conflict is reported once, not on every turn. */
  private readonly deliveredKeys = new Map<string, Set<string>>()

  /** When false (ablation), replicas still sync after every turn but no impact events are pushed to agents. */
  private readonly deliverEvents: boolean

  constructor(readonly members: Member[], options: { deliverEvents?: boolean } = {}) {
    this.deliverEvents = options.deliverEvents ?? true
    for (const member of members) {
      this.lastSeen.set(member.id, SemanticIndex.build(member.repo))
    }
  }

  member(id: string): Member {
    const member = this.members.find((candidate) => candidate.id === id)
    if (!member) {
      throw new Error(`Unknown member: ${id}`)
    }
    return member
  }

  syncAll(): void {
    for (let left = 0; left < this.members.length; left += 1) {
      for (let right = left + 1; right < this.members.length; right += 1) {
        this.members[left]!.repo.syncWith(this.members[right]!.repo)
      }
    }
    // A second pass makes every replica transitively complete for >2 members.
    if (this.members.length > 2) {
      for (let index = this.members.length - 1; index > 0; index -= 1) {
        this.members[index]!.repo.syncWith(this.members[index - 1]!.repo)
      }
    }
  }

  private undelivered(memberId: string, events: SemanticEvent[]): SemanticEvent[] {
    const seen = this.deliveredKeys.get(memberId) ?? new Set<string>()
    this.deliveredKeys.set(memberId, seen)
    return events.filter((event) => {
      const key = eventKey(event)
      if (seen.has(key)) {
        return false
      }
      seen.add(key)
      return true
    })
  }

  converged(): boolean {
    const snapshots = this.members.map((member) => JSON.stringify(member.repo.listFiles().map((file) => [file, member.repo.fileContent(file)])))
    return snapshots.every((snapshot) => snapshot === snapshots[0])
  }

  /** Compute the events a member's replica has accumulated since it was last observed. */
  observe(memberId: string): { index: SemanticIndex; events: SemanticEvent[]; conflicts: Conflict[] } {
    const member = this.member(memberId)
    const index = SemanticIndex.build(member.repo)
    const previous = this.lastSeen.get(memberId)!
    const diff = semanticDiff(previous, index)
    const conflicts = this.impact.analyze(diff, index)
    const events = eventsFromDiffAndConflicts(diff, index, conflicts)
    return { index, events, conflicts }
  }

  /** Mark the member's current replica state as seen (so its own edits are not reported back to it). */
  markSeen(memberId: string): void {
    this.lastSeen.set(memberId, SemanticIndex.build(this.member(memberId).repo))
  }

  /** Mode 1 step: sync, deliver each replica's incoming events to its agent, apply actions, sync again. */
  async step(): Promise<MultiStepReport> {
    this.stepNumber += 1
    this.syncAll()
    const reports: MemberStepReport[] = []

    for (const member of this.members) {
      const { index, events, conflicts } = this.observe(member.id)
      const actions: AgentAction[] = []
      const agent = member.agent
      const relevant = agent ? events.filter((event) => agent.subscriptions.some((subscription) => eventMatches(subscription, event))) : []

      if (agent && relevant.length > 0) {
        this.eventsDelivered.push({ memberId: member.id, events: relevant })
        const context = { repo: member.repo, index, myClaims: [] }
        const returned = isBatchAgent(agent)
          ? await agent.onEvents({ ...context, events: relevant })
          : (await Promise.all(relevant.map((event) => agent.onEvent({ ...context, event })))).flat()

        for (const action of returned) {
          applyAction(member.repo, action)
          actions.push(action)
        }
      }

      this.markSeen(member.id)
      reports.push({ memberId: member.id, events: relevant, conflicts, actions })
    }

    this.syncAll()
    return { step: this.stepNumber, members: reports }
  }

  async run(maxSteps: number): Promise<MultiStepReport[]> {
    const steps: MultiStepReport[] = []
    for (let index = 0; index < maxSteps; index += 1) {
      const step = await this.step()
      steps.push(step)
      if (step.members.every((member) => member.events.length === 0 && member.actions.length === 0)) {
        break
      }
    }
    return steps
  }

  /**
   * Mode 2: round-robin over task agents. After every agent turn the replicas sync and the other
   * members receive the impact events derived from what just arrived at their replica.
   */
  async runTasks(maxRounds: number): Promise<TaskRoundReport[]> {
    const rounds: TaskRoundReport[] = []
    const taskMembers = this.members.filter((member) => member.agent && isTaskAgent(member.agent))

    for (let round = 1; round <= maxRounds; round += 1) {
      const report: TaskRoundReport = { round, turns: [] }
      let anyActive = false

      for (const member of taskMembers) {
        const agent = member.agent as TaskAgent
        if (agent.taskDone()) {
          report.turns.push({ memberId: member.id, result: 'idle', deliveredTo: [] })
          continue
        }
        anyActive = true
        const result = await agent.nextTurn()
        this.markSeen(member.id)
        this.syncAll()
        const deliveredTo: Array<{ memberId: string; events: SemanticEvent[] }> = []

        for (const other of this.members) {
          if (other.id === member.id) {
            continue
          }
          const { events } = this.observe(other.id)
          this.markSeen(other.id)
          const target = other.agent
          const relevant = target ? this.undelivered(other.id, events.filter((event) => target.subscriptions.some((subscription) => eventMatches(subscription, event)))) : []
          if (target && isTaskAgent(target) && relevant.length > 0 && this.deliverEvents) {
            target.pushEvents(relevant)
            this.eventsDelivered.push({ memberId: other.id, events: relevant })
            deliveredTo.push({ memberId: other.id, events: relevant })
          }
        }

        report.turns.push({ memberId: member.id, result, deliveredTo })
      }

      rounds.push(report)
      if (!anyActive) {
        break
      }
    }

    this.syncAll()
    return rounds
  }
}

function applyAction(repo: Repo, action: AgentAction): void {
  if (action.kind === 'edit_file') {
    repo.editFile(action.path, action.edit)
  } else if (action.kind === 'claim_task') {
    repo.claimTask(action.taskId)
  } else if (action.kind === 'release_claim') {
    repo.releaseClaim(action.taskId, action.proposalId)
  }
}

import type { Conflict } from '@hit/impact-engine'
import type { ActiveClaim, Repo, TextEdit } from '@hit/repo-crdt'
import type { SemanticIndex } from '@hit/semantic-indexer'

export type SemanticEvent =
  | { type: 'symbol_signature_changed'; symbolId: string; from: string; to: string; consumers: string[] }
  | { type: 'symbol_removed'; symbolId: string; consumers: string[] }
  | { type: 'consumer_impacted'; conflict: Conflict }
  | { type: 'test_invalidated'; conflict: Conflict }

export interface Subscription {
  type: SemanticEvent['type'] | '*'
  /** Matches when the file is the origin or one of the affected files of the event. */
  file?: string
  /** Matches only when the file is among the affected (consumer) files of the event, never by origin alone. */
  affectedFile?: string
  symbolId?: string
}

export type ReadonlyRepo = Pick<Repo, 'fileContent' | 'fileLang' | 'listFiles' | 'getOperationLog' | 'activeClaim'>

export interface AgentContext {
  repo: ReadonlyRepo
  index: SemanticIndex
  event: SemanticEvent
  myClaims: ActiveClaim[]
}

export type AgentAction =
  | { kind: 'edit_file'; path: string; edit: TextEdit }
  | { kind: 'claim_task'; taskId: string }
  | { kind: 'release_claim'; taskId: string; proposalId: string }
  | { kind: 'noop'; note: string }

export interface Agent {
  id: string
  subscriptions: Subscription[]
  onEvent(ctx: AgentContext): Promise<AgentAction[]>
}

export function eventMatches(subscription: Subscription, event: SemanticEvent): boolean {
  if (subscription.type !== '*' && subscription.type !== event.type) {
    return false
  }

  if (subscription.symbolId && eventSymbolId(event) !== subscription.symbolId) {
    return false
  }

  if (subscription.file && !eventFiles(event).includes(subscription.file)) {
    return false
  }

  if (subscription.affectedFile && !eventAffectedFiles(event).includes(subscription.affectedFile)) {
    return false
  }

  return true
}

/** Files on the consumer side of an event: affected files of a conflict, or consumers of a symbol change. */
export function eventAffectedFiles(event: SemanticEvent): string[] {
  if (event.type === 'consumer_impacted' || event.type === 'test_invalidated') {
    return event.conflict.affected.map((affected) => affected.file)
  }

  return event.consumers
}

/** Stable identity of an event, used to deliver each event at most once per agent. */
export function eventKey(event: SemanticEvent): string {
  if (event.type === 'consumer_impacted' || event.type === 'test_invalidated') {
    return `${event.type}:${event.conflict.id}`
  }

  return `${event.type}:${event.symbolId}:${'to' in event ? event.to : ''}`
}

export function eventFiles(event: SemanticEvent): string[] {
  if (event.type === 'consumer_impacted' || event.type === 'test_invalidated') {
    return [event.conflict.origin.file, ...event.conflict.affected.map((affected) => affected.file)]
  }

  return event.consumers
}

export function eventSymbolId(event: SemanticEvent): string | undefined {
  if (event.type === 'symbol_signature_changed' || event.type === 'symbol_removed') {
    return event.symbolId
  }

  return event.conflict.origin.symbolId
}

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
  file?: string
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

  return true
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

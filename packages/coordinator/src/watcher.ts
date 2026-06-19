import type { Conflict } from '@hit/impact-engine'
import type { SemanticDiff, SemanticIndex } from '@hit/semantic-indexer'

import type { SemanticEvent } from './events.js'

export function eventsFromDiffAndConflicts(diff: SemanticDiff, index: SemanticIndex, conflicts: Conflict[]): SemanticEvent[] {
  const events: SemanticEvent[] = []

  for (const change of diff.changed) {
    const consumers = index.consumersOf(change.after.id).map((reference) => reference.fromFile)

    if (consumers.length > 0 && change.before.signature !== change.after.signature) {
      events.push({
        type: 'symbol_signature_changed',
        symbolId: change.after.id,
        from: change.before.signature,
        to: change.after.signature,
        consumers,
      })
    }
  }

  for (const removed of diff.removed) {
    const conflict = conflicts.find((candidate) => candidate.origin.symbolId === removed.id)
    const consumers = conflict?.affected.map((affected) => affected.file) ?? []

    if (consumers.length > 0) {
      events.push({
        type: 'symbol_removed',
        symbolId: removed.id,
        consumers,
      })
    }
  }

  for (const conflict of conflicts) {
    events.push({
      type: conflict.rule === 'R8' || conflict.rule === 'R9' ? 'test_invalidated' : 'consumer_impacted',
      conflict,
    })
  }

  return dedupeEvents(events)
}

function dedupeEvents(events: SemanticEvent[]): SemanticEvent[] {
  return [...new Map(events.map((event) => [JSON.stringify(event), event])).values()]
}

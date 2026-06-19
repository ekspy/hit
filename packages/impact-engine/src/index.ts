import { Repo } from '@hit/repo-crdt'
import { SemanticIndex, type SemanticDiff } from '@hit/semantic-indexer'
import { exec as execCallback } from 'node:child_process'
import { promisify } from 'node:util'

import { type Conflict, conflictId } from './conflicts.js'
import {
  conflictEvidence,
  groupLogicalConflicts,
  labelEvidence,
  type ConflictEvidence,
  type LogicalConflict,
} from './grouping.js'
import { matchLabels, scoreConflicts, type LabelConflict, type LabelMatch, type LabelsFile, type QualityReport, type RuleAttributionReport } from './labels.js'
import { propagationTargets } from './propagation.js'
import { analyzeRules } from './rules.js'

const exec = promisify(execCallback)

export class ImpactEngine {
  analyze(diff: SemanticDiff, index: SemanticIndex): Conflict[] {
    return analyzeRules(diff, index)
  }

  async confirm(repo: Repo, command?: string): Promise<Conflict[]> {
    const index = SemanticIndex.build(repo)
    const conflicts = analyzeRules({ added: [], removed: [], changed: [] }, index)

    if (!command) {
      return conflicts
    }

    try {
      await exec(command)
      return conflicts
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return [
        ...conflicts,
        {
          id: conflictId('R8', '<command>', undefined, [command]),
          rule: 'R8',
          level: 3,
          severity: 'high',
          origin: { file: '<command>' },
          affected: [],
          reason: `Command failed: ${message}`,
          status: 'pending',
        },
      ]
    }
  }
}

export { conflictEvidence, groupLogicalConflicts, labelEvidence, matchLabels, propagationTargets, scoreConflicts }
export type { Conflict, ConflictEvidence, LabelConflict, LabelMatch, LabelsFile, LogicalConflict, QualityReport, RuleAttributionReport }
export type { RuleId } from './conflicts.js'

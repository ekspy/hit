import type { Diagnostic, Loc } from '@hit/semantic-indexer'

export type RuleId = 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6' | 'R8' | 'R9'

export interface Conflict {
  id: string
  rule: RuleId
  level: 1 | 2 | 3
  severity: 'low' | 'medium' | 'high'
  origin: { file: string; symbolId?: string; opId?: string }
  affected: Array<{ file: string; loc?: Loc; symbolId?: string }>
  reason: string
  status: 'pending' | 'reconciled'
}

export function diagnosticAffected(diagnostic: Diagnostic): { file: string; loc?: Loc } | undefined {
  if (!diagnostic.file) {
    return undefined
  }

  return {
    file: diagnostic.file,
    loc:
      diagnostic.line !== undefined && diagnostic.column !== undefined
        ? {
            line: diagnostic.line,
            column: diagnostic.column,
          }
        : undefined,
  }
}

export function conflictId(rule: RuleId, originFile: string, symbolId: string | undefined, affectedFiles: string[]): string {
  return [rule, originFile, symbolId ?? '-', ...affectedFiles].join(':')
}

import type { Conflict } from './conflicts.js'

export function propagationTargets(conflicts: Conflict[]): string[] {
  return [...new Set(conflicts.flatMap((conflict) => conflict.affected.map((affected) => affected.file)))].sort()
}

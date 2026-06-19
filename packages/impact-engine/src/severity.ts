import type { RuleId } from './conflicts.js'

export function ruleLevel(rule: RuleId): 1 | 2 | 3 {
  if (rule === 'R5' || rule === 'R6') {
    return 2
  }

  if (rule === 'R8' || rule === 'R9') {
    return 3
  }

  return 1
}

export function ruleSeverity(rule: RuleId): 'low' | 'medium' | 'high' {
  if (rule === 'R8' || rule === 'R9' || rule === 'R3' || rule === 'R4') {
    return 'high'
  }

  if (rule === 'R5' || rule === 'R6') {
    return 'medium'
  }

  return 'medium'
}

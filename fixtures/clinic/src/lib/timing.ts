import type { Specialty } from './types'

export function estimateMinutes(patientId: string, baseMinutes: number, specialty: Specialty): number {
  const specialtyExtra = specialty === 'pediatrics' ? 15 : 0
  const firstVisitExtra = patientId.startsWith('new-') ? 10 : 0
  return baseMinutes + specialtyExtra + firstVisitExtra
}

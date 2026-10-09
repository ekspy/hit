import { listPatients } from './patients'
import type { Patient } from './types'

const handlers: Array<(patient: Patient, hoursBefore: number) => void> = []

export function onReminder(handler: (patient: Patient, hoursBefore: number) => void): void {
  handlers.push(handler)
}

export function fireReminders(hoursBefore: number): number {
  for (const patient of listPatients()) {
    for (const handler of handlers) {
      handler(patient, hoursBefore)
    }
  }

  return handlers.length
}

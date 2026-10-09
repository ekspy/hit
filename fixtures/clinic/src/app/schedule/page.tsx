import { Scheduler, formatSlot } from '../../lib'
import { estimateMinutes } from '../../lib/timing'
import type { Specialty } from '../../lib/types'

const scheduler = new Scheduler()

export function SchedulePage(patientId: string, specialty: Specialty): string {
  const minutes = estimateMinutes(patientId, 30, specialty)
  const booking = scheduler.book(patientId, { start: '2026-10-12T09:00', minutes }, specialty)
  return formatSlot(booking.slot)
}

export function UpcomingPage(): string[] {
  return scheduler.upcoming().map((booking) => formatSlot(booking.slot))
}

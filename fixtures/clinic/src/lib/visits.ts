import { findPatient } from './patients'
import type { Booking } from './types'

export function visitPatient(booking: Booking) {
  return findPatient(booking.patientId)
}

export function visitsOf(patientId: string, bookings: Booking[]): Booking[] {
  return bookings.filter((booking) => booking.patientId === patientId)
}

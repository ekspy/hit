import type { Booking, Slot, Specialty } from './types'

export class Scheduler {
  private bookings: Booking[] = []
  private nextId = 1

  book(patientId: string, slot: Slot, specialty: Specialty): Booking {
    const booking: Booking = { id: `b${this.nextId++}`, patientId, slot, specialty }
    this.bookings.push(booking)
    return booking
  }

  cancel(bookingId: string): boolean {
    const before = this.bookings.length
    this.bookings = this.bookings.filter((booking) => booking.id !== bookingId)
    return this.bookings.length < before
  }

  upcoming(): Booking[] {
    return [...this.bookings]
  }
}

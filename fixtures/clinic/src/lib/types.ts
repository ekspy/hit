export type Specialty = 'cardiology' | 'dermatology' | 'pediatrics'

export interface Patient {
  id: string
  name: string
  phone: string
  notes: string
}

export interface Slot {
  start: string
  minutes: number
}

export interface Booking {
  id: string
  patientId: string
  slot: Slot
  specialty: Specialty
}

import type { Patient } from './types'

const patients: Patient[] = [
  { id: 'p1', name: 'Ana Souza', phone: '42999990001', notes: '' },
  { id: 'p2', name: 'Bruno Lima', phone: '42999990002', notes: 'allergic to penicillin' },
]

export function findPatient(id: string): Patient {
  return patients.find((patient) => patient.id === id) ?? patients[0]!
}

export function listPatients(): Patient[] {
  return patients
}

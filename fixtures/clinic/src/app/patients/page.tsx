import { formatPhone, listPatients } from '../../lib'

export function PatientList(): string[] {
  return listPatients().map((patient) => `${patient.name} ${formatPhone(patient.phone)}`)
}

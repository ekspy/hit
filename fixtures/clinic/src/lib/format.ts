import type { Slot } from './types'

export function formatSlot(slot: Slot): string {
  return `${slot.start.replace('T', ' ')} (${slot.minutes} min)`
}

export function formatPhone(phone: string): string {
  return `(${phone.slice(0, 2)}) ${phone.slice(2)}`
}

import type { Unit } from './types'

export function formatQuantity(value: number): string
export function formatQuantity(value: number, unit: Unit): string
export function formatQuantity(value: number, unit?: Unit): string {
  return unit ? `${value} ${unit}` : String(value)
}

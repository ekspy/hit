import type { Item, Page } from './types'

const items: Item[] = [
  { sku: 'A-1', name: 'Bolt', quantity: 120 },
  { sku: 'B-2', name: 'Nut', quantity: 0 },
]

export function listItems(): Item[] {
  return items
}

export function findItem(sku: string) {
  return items.find((item) => item.sku === sku)
}

export function paginate<T>(rows: T[], size: number): Page<T> {
  return { items: rows.slice(0, size), total: rows.length }
}

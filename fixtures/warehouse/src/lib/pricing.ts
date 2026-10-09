import type { Item } from './types'

export default function priceOf(item: Item): number {
  return item.sku.startsWith('A') ? 499 : 199
}

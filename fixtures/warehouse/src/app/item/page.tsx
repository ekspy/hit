import { findItem } from '../../lib/catalog'

export function ItemPage(sku: string): string {
  const item = findItem(sku)

  if (!item) {
    return 'Unknown item'
  }

  return item.name
}

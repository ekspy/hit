import { findItem } from '../../lib/catalog'
import { formatQuantity } from '../../lib/format'
import priceOf from '../../lib/pricing'

export function LabelPage(sku: string): string {
  const item = findItem(sku)
  const price = item ? priceOf(item) : 0
  return `${formatQuantity(3, 'kg')} - ${price}`
}

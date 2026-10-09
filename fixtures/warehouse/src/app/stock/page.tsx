import { InventoryService, StockStatus } from '../../lib/inventory'

const service = new InventoryService()

export function statusLabel(status: StockStatus): string {
  switch (status) {
    case StockStatus.InStock:
      return 'In stock'
    case StockStatus.Backorder:
      return 'On backorder'
    case StockStatus.Discontinued:
      return 'Discontinued'
  }
}

export function reserveItem(sku: string): string {
  return service.reserve(sku, 1) ? `Reserved ${sku}` : `Could not reserve ${sku}`
}

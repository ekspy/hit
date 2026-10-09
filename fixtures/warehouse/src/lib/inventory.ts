export enum StockStatus {
  InStock = 'in_stock',
  Backorder = 'backorder',
  Discontinued = 'discontinued',
}

export class InventoryService {
  private reserved = new Map<string, number>()

  reserve(sku: string, quantity: number): boolean {
    this.reserved.set(sku, (this.reserved.get(sku) ?? 0) + quantity)
    return true
  }

  statusOf(quantity: number): StockStatus {
    return quantity > 0 ? StockStatus.InStock : StockStatus.Backorder
  }
}

export interface ShipmentOptions {
  carrier: string
  tracking?: {
    number: string
    notify?: boolean
  }
}

export function createShipment(sku: string, options: ShipmentOptions): string {
  const notify = options.tracking?.notify ? ' (notify)' : ''
  return `${sku} via ${options.carrier}${notify}`
}

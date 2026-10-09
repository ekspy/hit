import { createShipment, type ShipmentOptions } from '../../lib/shipping'

export function DispatchPage(sku: string): string {
  const options: ShipmentOptions = { carrier: 'ups', tracking: { number: '1Z999' } }
  return createShipment(sku, options)
}

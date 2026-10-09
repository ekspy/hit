export interface Item {
  sku: string
  name: string
  quantity: number
}

export interface Page<T> {
  items: T[]
  total: number
}

export type Unit = 'kg' | 'unit' | 'litre'

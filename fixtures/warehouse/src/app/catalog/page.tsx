import { listItems, paginate } from '../../lib/catalog'

export function CatalogPage(): string {
  const page = paginate(listItems(), 10)
  return `${page.items.map((item) => item.name).join(', ')} (${page.total})`
}

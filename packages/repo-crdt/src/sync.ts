import { Repo } from './document.js'

export function syncPair(left: Repo, right: Repo): void {
  left.syncWith(right)
}

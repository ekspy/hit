import type { OperationRecord } from './operations.js'

export function operationKey(operation: OperationRecord): string {
  return `${operation.actorId}:${operation.logicalTime}`
}

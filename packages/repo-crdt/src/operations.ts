export type Lang = 'ts' | 'tsx'

export type OpKind =
  | 'create_file'
  | 'edit_file'
  | 'delete_file'
  | 'rename_file'
  | 'create_task'
  | 'claim_task'
  | 'release_task'
  | 'complete_task'

export interface TaskInput {
  title: string
  description: string
}

export interface OperationRecord {
  actorId: string
  logicalTime: number
  kind: OpKind
  target: string
  summary: string
}

export interface ActiveClaim {
  taskId: string
  agentId: string
  proposalId: string
}

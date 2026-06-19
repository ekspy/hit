import * as Automerge from '@automerge/automerge'

import { applyTextEdit, createText, textToString, type CrdtText, type TextEdit } from './text.js'
import type { ActiveClaim, Lang, OperationRecord, TaskInput } from './operations.js'

interface FileRecord {
  content: CrdtText
  lang: Lang
  deleted?: boolean
}

interface TaskRecord {
  title: string
  description: string
  status: 'open' | 'done'
}

interface ClaimProposal {
  agentId: string
  logicalTime: number
  released?: boolean
}

export interface RepoDoc {
  [key: string]: unknown
  files: Record<string, FileRecord>
  tasks: Record<string, TaskRecord>
  claimProposals: Record<string, Record<string, ClaimProposal>>
  operations: Record<string, OperationRecord>
}

type AutomergeDoc = Automerge.Doc<RepoDoc>

function actorToAutomergeId(actorId: string): string {
  const hex = Buffer.from(actorId, 'utf8').toString('hex')
  return hex.length > 0 ? hex : '00'
}

let initialDocBytes: Uint8Array | undefined

function initialBytes(): Uint8Array {
  initialDocBytes ??= Automerge.save(
    Automerge.from<RepoDoc>(
      {
        files: {},
        tasks: {},
        claimProposals: {},
        operations: {},
      },
      '00',
    ),
  )
  return initialDocBytes
}

function emptyDoc(actorId: string): AutomergeDoc {
  return Automerge.load<RepoDoc>(initialBytes(), actorToAutomergeId(actorId))
}

function sortOperationIds([leftId, left]: [string, OperationRecord], [rightId, right]: [string, OperationRecord]): number {
  return left.logicalTime - right.logicalTime || left.actorId.localeCompare(right.actorId) || leftId.localeCompare(rightId)
}

export class Repo {
  private constructor(
    private actorId: string,
    private doc: AutomergeDoc,
    private logicalTime: number,
  ) {}

  static create(actorId: string): Repo {
    return new Repo(actorId, emptyDoc(actorId), 0)
  }

  static load(actorId: string, bytes: Uint8Array): Repo {
    const doc = Automerge.load<RepoDoc>(bytes, actorToAutomergeId(actorId))
    return new Repo(actorId, doc, maxLogicalTime(doc, actorId))
  }

  save(): Uint8Array {
    return Automerge.save(this.doc)
  }

  createFile(path: string, content: string, lang: Lang): void {
    this.commit('create_file', path, `Create ${path}`, (doc) => {
      doc.files[path] = { content: createText(content), lang }
    })
  }

  editFile(path: string, edit: TextEdit): void {
    this.commit('edit_file', path, `Edit ${path}`, (doc) => {
      const file = doc.files[path]

      if (!file || file.deleted) {
        throw new Error(`Cannot edit missing file: ${path}`)
      }

      applyTextEdit(file.content, edit)
    })
  }

  deleteFile(path: string): void {
    this.commit('delete_file', path, `Delete ${path}`, (doc) => {
      const file = doc.files[path]

      if (!file) {
        throw new Error(`Cannot delete missing file: ${path}`)
      }

      file.deleted = true
    })
  }

  renameFile(from: string, to: string): void {
    this.commit('rename_file', from, `Rename ${from} to ${to}`, (doc) => {
      const file = doc.files[from]

      if (!file || file.deleted) {
        throw new Error(`Cannot rename missing file: ${from}`)
      }

      doc.files[to] = {
        content: createText(textToString(file.content)),
        lang: file.lang,
      }
      file.deleted = true
    })
  }

  createTask(input: TaskInput): string {
    const taskId = this.nextId('task')
    this.commit('create_task', taskId, input.title, (doc) => {
      doc.tasks[taskId] = {
        ...input,
        status: 'open',
      }
      doc.claimProposals[taskId] = {}
    })
    return taskId
  }

  claimTask(taskId: string): string {
    const proposalId = this.nextId('claim')
    this.commit('claim_task', taskId, `Claim ${taskId}`, (doc, logicalTime) => {
      if (!doc.tasks[taskId]) {
        throw new Error(`Cannot claim missing task: ${taskId}`)
      }

      doc.claimProposals[taskId][proposalId] = {
        agentId: this.actorId,
        logicalTime,
      }
    })
    return proposalId
  }

  releaseClaim(taskId: string, proposalId: string): void {
    this.commit('release_task', taskId, `Release ${proposalId}`, (doc) => {
      const proposal = doc.claimProposals[taskId]?.[proposalId]

      if (!proposal) {
        throw new Error(`Cannot release missing claim: ${proposalId}`)
      }

      proposal.released = true
    })
  }

  completeTask(taskId: string): void {
    this.commit('complete_task', taskId, `Complete ${taskId}`, (doc) => {
      const task = doc.tasks[taskId]

      if (!task) {
        throw new Error(`Cannot complete missing task: ${taskId}`)
      }

      task.status = 'done'
    })
  }

  activeClaim(taskId: string): ActiveClaim | undefined {
    const proposals = Object.entries(this.doc.claimProposals[taskId] ?? {})
      .filter(([, proposal]) => !proposal.released)
      .sort(
        ([leftId, left], [rightId, right]) =>
          left.logicalTime - right.logicalTime || left.agentId.localeCompare(right.agentId) || leftId.localeCompare(rightId),
      )

    const [proposalId, proposal] = proposals[0] ?? []
    return proposal && proposalId
      ? {
          taskId,
          agentId: proposal.agentId,
          proposalId,
        }
      : undefined
  }

  syncWith(other: Repo): void {
    const local = this.doc
    const remote = other.doc

    this.doc = Automerge.merge(local, Automerge.clone(remote))
    other.doc = Automerge.merge(remote, Automerge.clone(local))
    this.logicalTime = Math.max(this.logicalTime, maxLogicalTime(this.doc, this.actorId))
    other.logicalTime = Math.max(other.logicalTime, maxLogicalTime(other.doc, other.actorId))
  }

  getHeads(): string[] {
    return Automerge.getHeads(this.doc)
  }

  getOperationLog(): OperationRecord[] {
    return Object.entries(this.doc.operations)
      .sort(sortOperationIds)
      .map(([, operation]) => ({ ...operation }))
  }

  fileContent(path: string): string {
    const file = this.doc.files[path]

    if (!file || file.deleted) {
      throw new Error(`Missing file: ${path}`)
    }

    return textToString(file.content)
  }

  fileLang(path: string): Lang {
    const file = this.doc.files[path]

    if (!file || file.deleted) {
      throw new Error(`Missing file: ${path}`)
    }

    return file.lang
  }

  listFiles(): string[] {
    return Object.entries(this.doc.files)
      .filter(([, file]) => !file.deleted)
      .map(([path]) => path)
      .sort()
  }

  listTaskIds(): string[] {
    return Object.keys(this.doc.tasks).sort()
  }

  private nextId(prefix: string): string {
    return `${prefix}:${this.actorId}:${this.logicalTime + 1}`
  }

  private commit(
    kind: OperationRecord['kind'],
    target: string,
    summary: string,
    mutate: (doc: RepoDoc, logicalTime: number) => void,
  ): void {
    const logicalTime = this.logicalTime + 1
    const opId = `${this.actorId}:${logicalTime}`

    this.doc = Automerge.change(this.doc, (doc) => {
      mutate(doc, logicalTime)
      doc.operations[opId] = {
        actorId: this.actorId,
        logicalTime,
        kind,
        target,
        summary,
      }
    })
    this.logicalTime = logicalTime
  }
}

function maxLogicalTime(doc: RepoDoc, actorId: string): number {
  return Object.values(doc.operations).reduce((max, operation) => {
    if (operation.actorId !== actorId) {
      return max
    }

    return Math.max(max, operation.logicalTime)
  }, 0)
}

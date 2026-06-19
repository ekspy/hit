import { Text } from '@automerge/automerge'

export type CrdtText = Text

export interface TextEdit {
  start: number
  deleteCount: number
  insert: string
}

export function createText(content: string): CrdtText {
  return new Text(content)
}

export function applyTextEdit(text: CrdtText, edit: TextEdit): void {
  if (edit.start < 0 || edit.deleteCount < 0 || edit.start > text.length) {
    throw new Error(`Invalid text edit start=${edit.start} deleteCount=${edit.deleteCount}`)
  }

  if (edit.deleteCount > 0) {
    text.deleteAt(edit.start, edit.deleteCount)
  }

  if (edit.insert.length > 0) {
    text.insertAt(edit.start, ...Array.from(edit.insert))
  }
}

export function textToString(text: CrdtText): string {
  return text.toString()
}

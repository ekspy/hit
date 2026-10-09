import { Text } from '@automerge/automerge'

export type CrdtText = Text

export interface TextEdit {
  start: number
  deleteCount: number
  insert: string
}

/** Characters per insert call: Automerge inserts spread each character as an argument, which overflows the stack on large files. */
const CHUNK = 8192

/** An empty text; fill it with `fillText` once it is attached to the document (large contents cannot go through the constructor). */
export function createText(): CrdtText {
  return new Text()
}

export function fillText(text: CrdtText, content: string): void {
  insertChunked(text, 0, content)
}

function insertChunked(text: CrdtText, start: number, content: string): void {
  const chars = Array.from(content)
  for (let offset = 0; offset < chars.length; offset += CHUNK) {
    text.insertAt(start + offset, ...chars.slice(offset, offset + CHUNK))
  }
}

export function applyTextEdit(text: CrdtText, edit: TextEdit): void {
  if (edit.start < 0 || edit.deleteCount < 0 || edit.start > text.length) {
    throw new Error(`Invalid text edit start=${edit.start} deleteCount=${edit.deleteCount}`)
  }

  if (edit.deleteCount > 0) {
    text.deleteAt(edit.start, edit.deleteCount)
  }

  if (edit.insert.length > 0) {
    insertChunked(text, edit.start, edit.insert)
  }
}

export function textToString(text: CrdtText): string {
  return text.toString()
}

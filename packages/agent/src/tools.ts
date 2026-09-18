import type { TextEdit } from '@hit/repo-crdt'
import type { Diagnostic } from '@hit/semantic-indexer'

import type { ToolDefinition } from './providers/types.js'
import type { Workspace } from './workspace.js'

export const AGENT_TOOLS: ToolDefinition[] = [
  {
    name: 'list_files',
    description: 'List every source file path in the repository.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'read_file',
    description: 'Return the full current content of a file. Always read a file before editing it.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Repository-relative path, e.g. src/lib/payments.ts' } },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'edit_file',
    description:
      'Replace one exact occurrence of `search` with `replace` in a file. `search` must be copied verbatim from read_file output (same whitespace and newlines) and must match exactly once; otherwise the tool returns an error and nothing changes. Use several small edits rather than one large one.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Repository-relative path' },
        search: { type: 'string', description: 'Exact text to find (must be unique in the file)' },
        replace: { type: 'string', description: 'Replacement text' },
      },
      required: ['path', 'search', 'replace'],
      additionalProperties: false,
    },
  },
  {
    name: 'run_typecheck',
    description: 'Type-check the whole repository as it currently is (including your edits) and return the diagnostics.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'done',
    description: 'Finish the session. Call this once the task is complete (or cannot be completed) with a short summary of what you changed.',
    parameters: {
      type: 'object',
      properties: { summary: { type: 'string', description: 'What you did, one to three sentences' } },
      required: ['summary'],
      additionalProperties: false,
    },
  },
]

export type EditConversion = { ok: true; edit: TextEdit } | { ok: false; error: string }

/** Convert an exact-match search/replace into a TextEdit; errors when the search is missing or ambiguous. */
export function searchReplaceToEdit(content: string, search: string, replace: string): EditConversion {
  if (search.length === 0) {
    return { ok: false, error: 'search must not be empty' }
  }

  const first = content.indexOf(search)
  if (first === -1) {
    return { ok: false, error: `search text not found${nearbyHint(content, search)}` }
  }

  const second = content.indexOf(search, first + search.length)
  if (second !== -1) {
    const count = content.split(search).length - 1
    return { ok: false, error: `search text is ambiguous: ${count} occurrences; include more surrounding context so it matches exactly once` }
  }

  return { ok: true, edit: { start: first, deleteCount: search.length, insert: replace } }
}

function nearbyHint(content: string, search: string): string {
  const firstLine = search.split('\n').map((line) => line.trim()).find((line) => line.length > 0)
  if (!firstLine) {
    return ''
  }
  const lines = content.split('\n')
  const index = lines.findIndex((line) => line.includes(firstLine))
  if (index === -1) {
    return '. Re-read the file and copy the text verbatim'
  }
  const context = lines.slice(Math.max(0, index - 1), index + 3).join('\n')
  return `. Whitespace or line breaks probably differ; the file near a similar line reads:\n${context}`
}

export interface ToolExecution {
  output: string
  isError: boolean
  edited?: { path: string; edit: TextEdit }
  done?: string
}

export function formatDiagnostics(diagnostics: Diagnostic[]): string {
  if (diagnostics.length === 0) {
    return 'Typecheck passed: 0 diagnostics.'
  }
  return [`Typecheck failed: ${diagnostics.length} diagnostic(s).`, ...diagnostics.map((d) => `${d.file ?? '?'}:${d.line ?? '?'}:${d.column ?? '?'} TS${d.code} ${d.message}`)].join('\n')
}

export function executeTool(workspace: Workspace, name: string, args: Record<string, unknown>, options: { readOnlyFiles?: string[] } = {}): ToolExecution {
  try {
    switch (name) {
      case 'list_files':
        return { output: workspace.listFiles().join('\n'), isError: false }
      case 'read_file': {
        const path = requireString(args, 'path')
        return { output: workspace.readFile(path), isError: false }
      }
      case 'edit_file': {
        const path = requireString(args, 'path')
        const search = requireString(args, 'search')
        const replace = typeof args.replace === 'string' ? args.replace : ''
        if (options.readOnlyFiles?.includes(path)) {
          return { output: `error: ${path} is owned by another agent and must not be edited`, isError: true }
        }
        const content = workspace.readFile(path)
        const conversion = searchReplaceToEdit(content, search, replace)
        if (!conversion.ok) {
          return { output: `error: ${conversion.error}`, isError: true }
        }
        workspace.editFile(path, conversion.edit)
        return { output: `ok: edited ${path}`, isError: false, edited: { path, edit: conversion.edit } }
      }
      case 'run_typecheck':
        return { output: formatDiagnostics(workspace.typecheck()), isError: false }
      case 'done':
        return { output: 'ok', isError: false, done: typeof args.summary === 'string' ? args.summary : '' }
      default:
        return { output: `error: unknown tool ${name}`, isError: true }
    }
  } catch (error) {
    return { output: `error: ${error instanceof Error ? error.message : String(error)}`, isError: true }
  }
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`missing string argument: ${key}`)
  }
  return value
}

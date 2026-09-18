import { Repo } from '@hit/repo-crdt'
import { describe, expect, it } from 'vitest'

import { RepoWorkspace, executeTool, searchReplaceToEdit } from '../src/index.js'

describe('searchReplaceToEdit', () => {
  it('converts a unique match to a TextEdit with offsets', () => {
    expect(searchReplaceToEdit('const a = 1\nconst b = 2\n', 'b = 2', 'b = 3')).toEqual({
      ok: true,
      edit: { start: 18, deleteCount: 5, insert: 'b = 3' },
    })
  })

  it('errors when the search is missing, with a whitespace hint', () => {
    const result = searchReplaceToEdit('const a = 1\n  const b = 2\n', 'const b = 3', 'x')
    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.error).toContain('not found')
  })

  it('errors when the search is ambiguous', () => {
    const result = searchReplaceToEdit('a\na\n', 'a', 'b')
    expect(result).toEqual({ ok: false, error: expect.stringContaining('ambiguous: 2 occurrences') })
  })

  it('rejects empty searches', () => {
    expect(searchReplaceToEdit('abc', '', 'x').ok).toBe(false)
  })
})

describe('executeTool', () => {
  function workspace(): RepoWorkspace {
    const repo = Repo.create('tools')
    repo.createFile('src/a.ts', 'export const a: number = 1\n', 'ts')
    repo.createFile('src/b.ts', "import { a } from './a'\nexport const b: string = a\n", 'ts')
    return new RepoWorkspace(repo)
  }

  it('applies edits to the replica and reports typecheck diagnostics', () => {
    const ws = workspace()
    expect(executeTool(ws, 'list_files', {}).output).toBe('src/a.ts\nsrc/b.ts')
    expect(executeTool(ws, 'run_typecheck', {}).output).toContain('Typecheck failed: 1')
    const edit = executeTool(ws, 'edit_file', { path: 'src/b.ts', search: 'b: string', replace: 'b: number' })
    expect(edit.isError).toBe(false)
    expect(edit.edited).toEqual({ path: 'src/b.ts', edit: { start: 37, deleteCount: 9, insert: 'b: number' } })
    expect(ws.readFile('src/b.ts')).toContain('export const b: number = a')
    expect(executeTool(ws, 'run_typecheck', {}).output).toBe('Typecheck passed: 0 diagnostics.')
  })

  it('returns errors for bad edits, missing files and read-only files without throwing', () => {
    const ws = workspace()
    expect(executeTool(ws, 'edit_file', { path: 'src/b.ts', search: 'nope', replace: '' }).isError).toBe(true)
    expect(executeTool(ws, 'read_file', { path: 'src/missing.ts' }).isError).toBe(true)
    expect(executeTool(ws, 'edit_file', { path: 'src/a.ts', search: '1', replace: '2' }, { readOnlyFiles: ['src/a.ts'] }).output).toContain('owned by another agent')
    expect(executeTool(ws, 'done', { summary: 'finished' }).done).toBe('finished')
  })
})

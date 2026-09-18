import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { repoFromDir, runFixtureTests, typecheckRepo, writeRepoToDir } from '../src/fs-repo.js'
import { GitPair } from '../src/git-worktree.js'
import { applyScript, loadAgentScript, loadFixtureRepo } from '../src/scenario.js'

describe('disk-backed repo', () => {
  it('round-trips a replica through a directory', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'hit-roundtrip-'))
    try {
      const repo = loadFixtureRepo('shopapp', 'rt')
      writeRepoToDir(repo, dir)
      const loaded = repoFromDir(dir, 'rt2')
      expect(loaded.listFiles()).toEqual(repo.listFiles())
      expect(loaded.fileContent('src/lib/payments.ts')).toBe(repo.fileContent('src/lib/payments.ts'))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('runs the fixture vitest suite in a temp copy', async () => {
    const result = await runFixtureTests(loadFixtureRepo('shopapp', 'tests'), 'shopapp')
    expect(result).toMatchObject({ ok: true, passed: 1, failed: 0 })
  }, 60_000)
})

describe('GitPair', () => {
  it('creates two worktrees, merges agent-b into agent-a and exposes late diagnostics', async () => {
    const pair = await GitPair.create('shopapp')
    try {
      const repoA = pair.loadRepo('agent-a')
      applyScript(repoA, loadAgentScript('01-return-type-change', 'agent-a'))
      pair.writeRepo('agent-a', repoA)
      await pair.commit('agent-a', 'agent-a changes')
      const repoB = pair.loadRepo('agent-b')
      applyScript(repoB, loadAgentScript('01-return-type-change', 'agent-b'))
      pair.writeRepo('agent-b', repoB)
      await pair.commit('agent-b', 'agent-b changes')

      const merge = await pair.merge()
      expect(merge.ok).toBe(true)
      const merged = pair.loadRepo('agent-a', 'merged')
      expect(merged.fileContent('src/lib/payments.ts')).toContain('state:')
      expect(typecheckRepo(merged).length).toBeGreaterThan(0)
      const log = await pair.git('agent-a').log()
      expect(log.total).toBeGreaterThanOrEqual(3)
    } finally {
      await pair.cleanup()
    }
  }, 60_000)

  it('records textual conflicts when both branches touch the same lines', async () => {
    const pair = await GitPair.create('shopapp')
    try {
      for (const [agentId, replacement] of [
        ['agent-a', "'created-a'"],
        ['agent-b', "'created-b'"],
      ] as const) {
        const repo = pair.loadRepo(agentId)
        const content = repo.fileContent('src/lib/payments.ts')
        repo.editFile('src/lib/payments.ts', { start: content.indexOf("'created' |"), deleteCount: "'created'".length, insert: replacement })
        pair.writeRepo(agentId, repo)
        await pair.commit(agentId, `${agentId} edit`)
      }
      const merge = await pair.merge()
      expect(merge.ok).toBe(false)
      expect(merge.conflictedFiles).toEqual(['src/lib/payments.ts'])
      expect(pair.loadRepo('agent-a', 'merged').fileContent('src/lib/payments.ts')).toContain('<<<<<<<')
    } finally {
      await pair.cleanup()
    }
  }, 60_000)
})

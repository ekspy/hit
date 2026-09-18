import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { Repo } from '@hit/repo-crdt'
import { simpleGit, type SimpleGit } from 'simple-git'

import { materializeFixture, repoFromDir, writeRepoToDir } from './fs-repo.js'
import { loadFixtureRepo } from './scenario.js'

export interface MergeOutcome {
  ok: boolean
  conflictedFiles: string[]
  message: string
}

/**
 * Real git baseline: a temp repository initialised from the fixture, one branch + worktree per agent.
 * Agents work in their worktree (through a Repo loaded from it), commit, and `agent-b` is merged into `agent-a`.
 */
export class GitPair {
  private constructor(
    readonly root: string,
    readonly fixture: string,
    readonly agentIds: string[],
  ) {}

  static async create(fixture: string, agentIds = ['agent-a', 'agent-b']): Promise<GitPair> {
    const root = mkdtempSync(path.join(os.tmpdir(), 'hit-git-'))
    const main = path.join(root, 'main')
    materializeFixture(fixture, main)
    writeRepoToDir(loadFixtureRepo(fixture, 'git-seed'), main)
    const git = simpleGit(main)
    await git.init(['-b', 'main'])
    await git.addConfig('user.name', 'hit-eval')
    await git.addConfig('user.email', 'hit-eval@example.com')
    await git.addConfig('commit.gpgsign', 'false')
    await git.raw(['add', 'src', 'package.json', 'tsconfig.json'])
    await git.commit('fixture')

    const pair = new GitPair(root, fixture, agentIds)
    for (const agentId of agentIds) {
      await git.raw(['branch', agentId])
      await git.raw(['worktree', 'add', pair.worktree(agentId), agentId])
      materializeFixture(fixture, pair.worktree(agentId))
    }
    return pair
  }

  worktree(agentId: string): string {
    return path.join(this.root, 'wt', agentId)
  }

  git(agentId: string): SimpleGit {
    return simpleGit(this.worktree(agentId))
  }

  loadRepo(agentId: string, actorId = agentId): Repo {
    return repoFromDir(this.worktree(agentId), actorId)
  }

  writeRepo(agentId: string, repo: Repo): void {
    writeRepoToDir(repo, this.worktree(agentId))
  }

  async commit(agentId: string, message: string): Promise<void> {
    const git = this.git(agentId)
    await git.raw(['add', '-A', 'src'])
    await git.commit(message, ['--allow-empty'])
  }

  /** Merge every other agent's branch into the first agent's worktree. Textual conflicts are recorded and left as markers. */
  async merge(): Promise<MergeOutcome> {
    const [target, ...others] = this.agentIds
    const git = this.git(target!)
    const conflicted = new Set<string>()
    const messages: string[] = []

    for (const other of others) {
      try {
        const result = await git.merge([other, '--no-edit'])
        messages.push(`merged ${other}: ${result.result}`)
      } catch (error) {
        const status = await git.status()
        for (const file of status.conflicted) {
          conflicted.add(file)
        }
        messages.push(`merge of ${other} produced ${status.conflicted.length} conflicted file(s): ${status.conflicted.join(', ')}`)
        // Keep the conflict markers in the working tree: the repairing agent must resolve them.
        if (status.conflicted.length === 0) {
          messages.push(String(error instanceof Error ? error.message : error))
        }
      }
    }

    return { ok: conflicted.size === 0, conflictedFiles: [...conflicted].sort(), message: messages.join('; ') }
  }

  mergedTarget(): string {
    return this.agentIds[0]!
  }

  async cleanup(): Promise<void> {
    rmSync(this.root, { recursive: true, force: true })
  }
}

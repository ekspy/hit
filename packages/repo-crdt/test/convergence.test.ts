import { describe, expect, it } from 'vitest'

import { Repo } from '../src/index.js'

function snapshot(repo: Repo): unknown {
  return {
    files: repo.listFiles().map((path) => [path, repo.fileContent(path)]),
    operations: repo.getOperationLog(),
    tasks: repo.listTaskIds().map((taskId) => [taskId, repo.activeClaim(taskId)]),
  }
}

describe('Repo', () => {
  it('converges file edits and operation logs across two replicas', () => {
    const left = Repo.create('agent-a')
    const right = Repo.create('agent-b')

    left.createFile('src/lib/payments.ts', 'export const value = 1\n', 'ts')
    left.syncWith(right)

    left.editFile('src/lib/payments.ts', { start: 21, deleteCount: 1, insert: '2' })
    right.createFile('src/lib/orders.ts', 'export const order = 1\n', 'ts')

    right.syncWith(left)
    left.syncWith(right)

    expect(snapshot(left)).toEqual(snapshot(right))
    expect(left.fileContent('src/lib/payments.ts')).toContain('2')
    expect(left.listFiles()).toEqual(['src/lib/orders.ts', 'src/lib/payments.ts'])
  })

  it('converges deterministic active claims across three replicas', () => {
    const alpha = Repo.create('agent-a')
    const beta = Repo.create('agent-b')
    const gamma = Repo.create('agent-c')

    const taskId = alpha.createTask({
      title: 'Update checkout',
      description: 'React to payment changes',
    })

    alpha.syncWith(beta)
    beta.syncWith(gamma)

    const betaClaim = beta.claimTask(taskId)
    gamma.claimTask(taskId)
    alpha.claimTask(taskId)

    gamma.syncWith(alpha)
    beta.syncWith(gamma)
    alpha.syncWith(beta)
    gamma.syncWith(alpha)

    expect(snapshot(alpha)).toEqual(snapshot(beta))
    expect(snapshot(beta)).toEqual(snapshot(gamma))
    expect(alpha.activeClaim(taskId)).toEqual({
      taskId,
      agentId: 'agent-b',
      proposalId: `claim:agent-b:1`,
    })

    beta.releaseClaim(taskId, betaClaim)
    beta.syncWith(alpha)
    alpha.syncWith(gamma)
    gamma.syncWith(beta)

    expect(snapshot(alpha)).toEqual(snapshot(gamma))
  })

  it('round-trips through save and load', () => {
    const repo = Repo.create('agent-a')
    repo.createFile('src/a.ts', 'export const a = 1\n', 'ts')

    const loaded = Repo.load('agent-b', repo.save())

    expect(loaded.listFiles()).toEqual(['src/a.ts'])
    expect(loaded.fileContent('src/a.ts')).toBe('export const a = 1\n')
  })
})

import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

import { packageName } from '../src/index.js'

const execFile = promisify(execFileCallback)

describe('cli', () => {
  it('loads package exports', () => {
    expect(packageName).toBe('@hit/cli')
  })

  it('runs the return-type scenario through scripted agents', async () => {
    const result = await execFile('pnpm', ['--filter', '@hit/cli', 'run', 'dev', '--', 'run', '01-return-type-change', '--agents', 'scripted'])

    expect(result.stdout).toContain('scenario: 01-return-type-change')
    expect(result.stdout).toContain('diagnostics: 0')
    expect(result.stdout).toContain('event consumer_impacted')
  })
})

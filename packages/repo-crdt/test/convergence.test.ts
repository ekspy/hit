import { describe, expect, it } from 'vitest'

import { packageName } from '../src/index.js'

describe('repo-crdt scaffold', () => {
  it('loads package exports', () => {
    expect(packageName).toBe('@hit/repo-crdt')
  })
})

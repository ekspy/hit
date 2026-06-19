import { describe, expect, it } from 'vitest'

import { packageName } from '../src/index.js'

describe('agent scaffold', () => {
  it('loads package exports', () => {
    expect(packageName).toBe('@hit/agent')
  })
})

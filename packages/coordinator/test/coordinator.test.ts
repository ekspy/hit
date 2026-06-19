import { describe, expect, it } from 'vitest'

import { packageName } from '../src/index.js'

describe('coordinator scaffold', () => {
  it('loads package exports', () => {
    expect(packageName).toBe('@hit/coordinator')
  })
})

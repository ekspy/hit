import { describe, expect, it } from 'vitest'

import { packageName } from '../src/index.js'

describe('impact-engine scaffold', () => {
  it('loads package exports', () => {
    expect(packageName).toBe('@hit/impact-engine')
  })
})

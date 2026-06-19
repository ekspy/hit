import { describe, expect, it } from 'vitest'

import { packageName } from '../src/index.js'

describe('eval scaffold', () => {
  it('loads package exports', () => {
    expect(packageName).toBe('@hit/eval')
  })
})

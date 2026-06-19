import { describe, expect, it } from 'vitest'

import { packageName } from '../src/index.js'

describe('cli scaffold', () => {
  it('loads package exports', () => {
    expect(packageName).toBe('@hit/cli')
  })
})

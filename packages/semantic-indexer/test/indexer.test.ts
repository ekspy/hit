import { describe, expect, it } from 'vitest'

import { packageName } from '../src/index.js'

describe('semantic-indexer scaffold', () => {
  it('loads package exports', () => {
    expect(packageName).toBe('@hit/semantic-indexer')
  })
})

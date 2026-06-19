import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@hit/repo-crdt': new URL('./packages/repo-crdt/src/index.ts', import.meta.url).pathname,
      '@hit/semantic-indexer': new URL('./packages/semantic-indexer/src/index.ts', import.meta.url).pathname,
      '@hit/impact-engine': new URL('./packages/impact-engine/src/index.ts', import.meta.url).pathname,
      '@hit/coordinator': new URL('./packages/coordinator/src/index.ts', import.meta.url).pathname,
      '@hit/agent': new URL('./packages/agent/src/index.ts', import.meta.url).pathname,
      '@hit/eval': new URL('./packages/eval/src/index.ts', import.meta.url).pathname,
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
  },
})

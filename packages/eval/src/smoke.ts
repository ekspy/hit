/**
 * Cheapest end-to-end check: one Mode 1 run per condition on scenario 01, one rep, for the given models
 * (defaults to gpt-5.6-terra). Usage: pnpm eval:smoke [--models ...]
 */
import { parseBatchArgs, runBatch } from './batch.js'

const argv = process.argv.slice(2)
if (!argv.includes('--models')) {
  argv.push('--models', 'gpt-5.6-terra')
}
await runBatch(parseBatchArgs('mode1', ['--reps', '1', '--scenarios', '01-return-type-change', ...argv]))

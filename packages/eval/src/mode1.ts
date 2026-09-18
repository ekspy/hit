import { parseBatchArgs, runBatch } from './batch.js'

await runBatch(parseBatchArgs('mode1', process.argv.slice(2)))

import { parseBatchArgs, runBatch } from './batch.js'

await runBatch(parseBatchArgs('mode2', process.argv.slice(2)))

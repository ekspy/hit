export const packageName = '@hit/eval'
export {
  applyScript,
  loadAgentScript,
  loadFixtureRepo,
  loadScenario,
  runScenario,
  scriptedRepairs,
  type AgentScript,
  type ScenarioConfig,
  type ScenarioRunResult,
  type ScriptOperation,
} from './scenario.js'
export { GitPair, type MergeOutcome } from './git-worktree.js'
export { repoFromDir, runFixtureTests, typecheckRepo, writeRepoToDir } from './fs-repo.js'
export { executeRun, actedAfterEvent, loadTaskPair, type Condition, type Mode, type RunMetrics, type RunResult, type RunSpec, type TaskPair } from './runs.js'
export { aggregate, aggregateMarkdown, loadRuns, stats, writeAggregate } from './aggregate.js'
export { MODE1_SCENARIOS, parseBatchArgs, runBatch, type BatchOptions } from './batch.js'
export { loadDotEnv } from './env.js'

import { describe, expect, it } from 'vitest'

import { aggregate, aggregateMarkdown, stats } from '../src/aggregate.js'
import { MODE1_SCENARIOS, parseBatchArgs } from '../src/batch.js'
import { actedAfterEvent, type RunResult } from '../src/runs.js'

function run(condition: 'hit' | 'git', rep: number, cost: number, pass: boolean): RunResult {
  return {
    spec: { mode: 'mode1', model: 'gpt-5.6-terra', scenario: '01-return-type-change', condition, rep },
    startedAt: '',
    finishedAt: '',
    metrics: { typecheckPass: pass, diagnostics: pass ? 0 : 2, testsPass: pass, testsPassed: 1, testsFailed: 0, edits: 2, turns: 4, inputTokens: 1000, outputTokens: 100, costUsd: cost, wallClockMs: 10_000, latencyP50Ms: 2000, llmCalls: 4, eventsDelivered: 3, actedAfterEvent: true, mergeConflicts: 0, converged: true },
    eventsDelivered: [],
    finalDiagnostics: [],
    testOutput: '',
    agents: [],
    calls: [],
  }
}

describe('aggregation', () => {
  it('computes mean/sd/min/max', () => {
    expect(stats([1, 2, 3, 4])).toEqual({ n: 4, mean: 2.5, sd: expect.closeTo(1.291, 3), min: 1, max: 4 })
    expect(stats([])).toEqual({ n: 0, mean: 0, sd: 0, min: 0, max: 0 })
  })

  it('groups per (model, condition, scenario), pairs hit vs git and totals cost per model', () => {
    const report = aggregate('mode1', [run('hit', 1, 0.01, true), run('hit', 2, 0.03, false), run('git', 1, 0.02, true)])
    expect(report.groups.map((group) => [group.condition, group.runs])).toEqual([
      ['git', 1],
      ['hit', 2],
    ])
    expect(report.groups[1]?.metrics.typecheckPass.mean).toBe(0.5)
    expect(report.groups[1]?.metrics.costUsd).toMatchObject({ mean: 0.02, min: 0.01, max: 0.03 })
    expect(report.paired[0]).toMatchObject({ hit: { runs: 2, typecheckPass: 0.5 }, git: { runs: 1, typecheckPass: 1 } })
    expect(report.costByModel['gpt-5.6-terra']).toMatchObject({ runs: 3, costUsd: expect.closeTo(0.06, 6) })
    const markdown = aggregateMarkdown(report)
    expect(markdown).toContain('## Paired hit vs git per scenario')
    expect(markdown).toContain('| gpt-5.6-terra |01-return-type-change |2 |1 |50% |100% |')
  })

  it('flags an edit following an injected event', () => {
    const base = { assistantText: '', usage: { input: 0, output: 0 }, latencyMs: 0, costUsd: 0 }
    const edit = { name: 'edit_file', args: {}, output: 'ok', isError: false }
    const session = { kind: 'task' as const, system: '', turns: 2, edits: 1, done: true, usage: { input: 0, output: 0 }, costUsd: 0, latenciesMs: [] }
    expect(actedAfterEvent({ ...session, turnRecords: [{ ...base, turn: 1, toolCalls: [edit] }, { ...base, turn: 2, injectedEvents: [{ type: 'symbol_removed', symbolId: 'x', consumers: [] }], toolCalls: [] }] })).toBe(false)
    expect(actedAfterEvent({ ...session, turnRecords: [{ ...base, turn: 1, injectedEvents: [{ type: 'symbol_removed', symbolId: 'x', consumers: [] }], toolCalls: [] }, { ...base, turn: 2, toolCalls: [edit] }] })).toBe(true)
  })
})

describe('parseBatchArgs', () => {
  it('parses flags with prefix scenario resolution and defaults', () => {
    const options = parseBatchArgs('mode1', ['--models', 'gpt-5.6-terra,gemini-3.1-pro-preview', '--reps', '2', '--scenarios', '01,14', '--conditions', 'hit'])
    expect(options).toMatchObject({ mode: 'mode1', models: ['gpt-5.6-terra', 'gemini-3.1-pro-preview'], reps: 2, scenarios: ['01-return-type-change', '14-interface-field-rename'], conditions: ['hit'], concurrency: 4, budgetUsd: 15, maxTurns: 12 })
    expect(parseBatchArgs('mode1', []).scenarios).toEqual(MODE1_SCENARIOS)
    expect(parseBatchArgs('mode2', ['--scenarios', '01,pair-03']).scenarios).toEqual(['pair-01', 'pair-03'])
    expect(parseBatchArgs('mode2', []).reps).toBe(3)
    expect(() => parseBatchArgs('mode1', ['--models', 'gpt-4'])).toThrow('Unknown model')
  })
})

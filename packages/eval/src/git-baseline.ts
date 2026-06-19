import { ImpactEngine } from '@hit/impact-engine'
import { SemanticIndex, semanticDiff } from '@hit/semantic-indexer'

import { applyScript, loadAgentScript, loadFixtureRepo, runScenario } from './scenario.js'

export async function gitPilot(): Promise<{
  scenarios: Array<{
    id: string
    gitBaseline: { textualMergeConflicts: number; diagnosticsAfterIntegration: number; repairSteps: number }
    hit: { earlyEvents: number; finalDiagnostics: number; repairActions: number }
  }>
}> {
  const id = '01-return-type-change'
  const repo = loadFixtureRepo('shopapp', 'git-pilot')
  const before = SemanticIndex.build(repo)
  applyScript(repo, loadAgentScript(id, 'agent-a'))
  applyScript(repo, loadAgentScript(id, 'agent-b'))
  const after = SemanticIndex.build(repo)
  const baselineConflicts = new ImpactEngine().analyze(semanticDiff(before, after), after)
  const hit = await runScenario(id, 'scripted')

  return {
    scenarios: [
      {
        id,
        gitBaseline: {
          textualMergeConflicts: 0,
          diagnosticsAfterIntegration: after.diagnostics().length,
          repairSteps: baselineConflicts.length,
        },
        hit: {
          earlyEvents: hit.run.steps[0]?.events.length ?? 0,
          finalDiagnostics: hit.diagnostics.length,
          repairActions: hit.run.steps.flatMap((step) => step.actions).filter(({ action }) => action.kind === 'edit_file').length,
        },
      },
    ],
  }
}

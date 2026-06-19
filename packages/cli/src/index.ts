#!/usr/bin/env node

import { Command } from 'commander'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { loadFixtureRepo, runScenario } from '@hit/eval'
import { Repo } from '@hit/repo-crdt'
import { SemanticIndex } from '@hit/semantic-indexer'

export const packageName = '@hit/cli'

const stateDir = '.hit'
const stateFile = path.join(stateDir, 'repo.bin')

export async function main(argv = process.argv): Promise<void> {
  const program = new Command()
    .name('hit')
    .description('Hit prototype CLI')
    .version('0.1.0')

  program.command('init').action(() => {
    mkdirSync(stateDir, { recursive: true })
    writeFileSync(stateFile, Repo.create('cli').save())
    console.log('initialized .hit/repo.bin')
  })

  program.command('import').argument('<fixtureOrDir>').action((fixtureOrDir: string) => {
    mkdirSync(stateDir, { recursive: true })
    const fixture = fixtureOrDir.includes('/') ? path.basename(fixtureOrDir) : fixtureOrDir
    const repo = loadFixtureRepo(fixture === 'shopapp' ? 'shopapp' : fixtureOrDir, 'cli')
    writeFileSync(stateFile, repo.save())
    console.log(`imported ${repo.listFiles().length} files`)
  })

  program.command('status').action(() => {
    const repo = loadState()
    console.log(`${repo.listFiles().length} files, ${repo.getOperationLog().length} operations`)
  })

  program.command('index').action(() => {
    const repo = loadState()
    const index = SemanticIndex.build(repo)
    console.log(`${index.symbols().length} symbols, ${index.diagnostics().length} diagnostics`)
  })

  program
    .command('claim')
    .argument('<taskId>')
    .option('--as <agent>', 'agent id', 'cli')
    .action((taskId: string, options: { as: string }) => {
      const repo = loadState(options.as)
      const proposalId = repo.claimTask(taskId)
      saveState(repo)
      console.log(proposalId)
    })

  program
    .command('run')
    .argument('<scenario>')
    .option('--agents <kind>', 'agent kind', 'scripted')
    .action(async (scenario: string, options: { agents: 'scripted' }) => {
      const result = await runScenario(scenario, options.agents)
      const events = result.run.steps.flatMap((step) => step.events)
      const actions = result.run.steps.flatMap((step) => step.actions)
      console.log(`scenario: ${result.scenario.id}`)
      console.log(`events: ${events.length}`)
      console.log(`actions: ${actions.length}`)
      console.log(`diagnostics: ${result.diagnostics.length}`)

      for (const event of events) {
        console.log(`event ${event.type}`)
      }
    })

  program.command('inspect').argument('<kind>').argument('<id>').action((kind: string, id: string) => {
    if (kind !== 'conflict') {
      throw new Error(`Unsupported inspect kind: ${kind}`)
    }

    console.log(`conflict inspection is available in eval reports: ${id}`)
  })

  program.command('sync').argument('<left>').argument('<right>').action((left: string, right: string) => {
    const leftRepo = Repo.load('left', readFileSync(left))
    const rightRepo = Repo.load('right', readFileSync(right))
    leftRepo.syncWith(rightRepo)
    writeFileSync(left, leftRepo.save())
    writeFileSync(right, rightRepo.save())
    console.log('synced')
  })

  program.command('bench').argument('<target>').action((target: string) => {
    if (target !== 'propagation') {
      throw new Error(`Unsupported bench target: ${target}`)
    }

    console.log('Use pnpm eval for propagation latency reports')
  })

  await program.parseAsync(argv)
}

function loadState(actorId = 'cli'): Repo {
  try {
    return Repo.load(actorId, readFileSync(stateFile))
  } catch {
    return loadFixtureRepo('shopapp', actorId)
  }
}

function saveState(repo: Repo): void {
  mkdirSync(stateDir, { recursive: true })
  writeFileSync(stateFile, repo.save())
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}

import { Repo } from '@hit/repo-crdt'
import { describe, expect, it } from 'vitest'

import { Runtime, type Agent } from '../src/index.js'

describe('Runtime', () => {
  it('dispatches semantic events and applies agent edits', async () => {
    const repo = Repo.create('runtime')
    repo.createFile('src/api.ts', "export function api(): { value: string } {\nreturn { value: 'ok' }\n}\n", 'ts')
    repo.createFile('src/app.ts', "import { api } from './api'\nexport const value = api().value\n", 'ts')
    const agent: Agent = {
      id: 'fixer',
      subscriptions: [{ type: 'consumer_impacted', file: 'src/app.ts' }],
      async onEvent(ctx) {
        const content = ctx.repo.fileContent('src/app.ts')
        const start = content.indexOf('.value')

        if (start === -1) {
          return [{ kind: 'noop', note: 'already repaired' }]
        }

        return [
          {
            kind: 'edit_file',
            path: 'src/app.ts',
            edit: {
              start,
              deleteCount: '.value'.length,
              insert: '.label',
            },
          },
        ]
      },
    }
    const runtime = new Runtime(repo, [agent])
    const content = repo.fileContent('src/api.ts')
    repo.editFile('src/api.ts', {
      start: content.indexOf('value: string'),
      deleteCount: 'value: string'.length,
      insert: 'label: string',
    })
    repo.editFile('src/api.ts', {
      start: repo.fileContent('src/api.ts').indexOf('value:'),
      deleteCount: 'value:'.length,
      insert: 'label:',
    })

    const report = await runtime.step()

    expect(report.events.map((event) => event.type)).toContain('consumer_impacted')
    expect(report.actions.filter(({ action }) => action.kind === 'edit_file')).toHaveLength(1)
    expect(repo.fileContent('src/app.ts')).toContain('api().label')
  })
})

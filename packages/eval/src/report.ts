import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export function writeReport(name: string, json: unknown, markdown: string): void {
  const reportsDir = path.join(workspaceRoot(), 'reports')
  mkdirSync(reportsDir, { recursive: true })
  writeFileSync(path.join(reportsDir, `${name}.json`), `${JSON.stringify(json, null, 2)}\n`)
  writeFileSync(path.join(reportsDir, `${name}.md`), `${markdown.trim()}\n`)
}

export function table(headers: string[], rows: Array<Array<string | number>>): string {
  return [
    `| ${headers.join(' |')} |`,
    `| ${headers.map(() => '---').join(' |')} |`,
    ...rows.map((row) => `| ${row.join(' |')} |`),
  ].join('\n')
}

function workspaceRoot(): string {
  let current = process.cwd()

  while (current !== path.dirname(current)) {
    try {
      statSync(path.join(current, 'pnpm-workspace.yaml'))
      return current
    } catch {
      current = path.dirname(current)
    }
  }

  throw new Error('Could not find workspace root')
}

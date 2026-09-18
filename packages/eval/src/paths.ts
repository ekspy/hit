import { statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export function workspaceRoot(): string {
  let current = path.dirname(fileURLToPath(import.meta.url))

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

export function reportsDir(): string {
  return path.join(workspaceRoot(), 'reports')
}

export function scenarioDir(id: string): string {
  return path.join(workspaceRoot(), 'packages/eval/scenarios', id)
}

export function tasksDir(): string {
  return path.join(workspaceRoot(), 'packages/eval/tasks')
}

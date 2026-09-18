import { readFileSync } from 'node:fs'
import path from 'node:path'

import { workspaceRoot } from './paths.js'

/** Tiny .env loader: KEY=VALUE lines, `#` comments, optional quotes. Never overrides existing env, never prints values. */
export function loadDotEnv(file = path.join(workspaceRoot(), '.env')): string[] {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return []
  }

  const loaded: string[] = []
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) {
      continue
    }
    const eq = line.indexOf('=')
    if (eq === -1) {
      continue
    }
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '')
    let value = line.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (key && process.env[key] === undefined) {
      process.env[key] = value
      loaded.push(key)
    }
  }
  return loaded
}

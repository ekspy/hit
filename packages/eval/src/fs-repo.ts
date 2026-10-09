import { execFile } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { Repo } from '@hit/repo-crdt'
import { SemanticIndex, type Diagnostic } from '@hit/semantic-indexer'

import { workspaceRoot } from './paths.js'

/** Load a Repo from an on-disk project directory (its `src/` tree), so the same agent tools work on a git worktree. */
export function repoFromDir(dir: string, actorId: string): Repo {
  const repo = Repo.create(actorId)
  const root = path.join(dir, 'src')
  for (const file of listSourceFiles(root)) {
    const relative = path.posix.join('src', path.relative(root, file).split(path.sep).join(path.posix.sep))
    repo.createFile(relative, readFileSync(file, 'utf8'), relative.endsWith('.tsx') ? 'tsx' : 'ts')
  }
  return repo
}

/** Write the replica's files back to disk under `dir`; files present on disk but not in the repo are removed. */
export function writeRepoToDir(repo: Repo, dir: string): void {
  const root = path.join(dir, 'src')
  const wanted = new Set(repo.listFiles())
  if (existsSync(root)) {
    for (const file of listSourceFiles(root)) {
      const relative = path.posix.join('src', path.relative(root, file).split(path.sep).join(path.posix.sep))
      if (!wanted.has(relative)) {
        rmSync(file)
      }
    }
  }
  for (const file of wanted) {
    const target = path.join(dir, file)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, repo.fileContent(file))
  }
}

export function typecheckRepo(repo: Repo): Diagnostic[] {
  return SemanticIndex.build(repo).diagnostics()
}

export interface FixtureTestResult {
  ok: boolean
  passed: number
  failed: number
  output: string
}

/** Materialize the fixture's package.json/tsconfig into `dir` and symlink the workspace node_modules so vitest resolves. */
export function materializeFixture(fixture: string, dir: string): void {
  const source = path.join(workspaceRoot(), 'fixtures', fixture)
  mkdirSync(dir, { recursive: true })
  for (const file of ['package.json', 'tsconfig.json']) {
    if (existsSync(path.join(source, file))) {
      cpSync(path.join(source, file), path.join(dir, file))
    }
  }
  const nodeModules = path.join(dir, 'node_modules')
  if (!existsSync(nodeModules)) {
    symlinkSync(path.join(workspaceRoot(), 'node_modules'), nodeModules, 'dir')
  }
}

/** Run the fixture's vitest suite against the replica's files in a temp copy. */
export async function runFixtureTests(repo: Repo, fixture: string): Promise<FixtureTestResult> {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'hit-tests-'))
  try {
    materializeFixture(fixture, dir)
    writeRepoToDir(repo, dir)
    return await runVitest(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export interface AcceptanceResult extends FixtureTestResult {
  /** Contract-adherence violations: `file: pattern` for each forbidden pattern found in a consumer non-test file. */
  contractViolations: string[]
}

interface ContractRules {
  generic: string[]
  pairs: Record<string, Record<string, string[]>>
}

/**
 * Hidden acceptance oracle for a Mode 2 task pair: the pair's vitest file (never shown to agents) runs against the final
 * files in a temp copy, and consumer files are scanned for accesses to the producer's old contract through type assertions.
 */
export async function runAcceptance(repo: Repo, fixture: string, pairId: string, consumerFiles: string[]): Promise<AcceptanceResult> {
  const acceptance = path.join(workspaceRoot(), 'packages/eval/acceptance')
  const dir = mkdtempSync(path.join(os.tmpdir(), 'hit-acceptance-'))
  try {
    materializeFixture(fixture, dir)
    writeRepoToDir(repo, dir)
    const target = path.join(dir, 'src', '__acceptance__')
    mkdirSync(target, { recursive: true })
    cpSync(path.join(acceptance, '_helpers.ts'), path.join(target, '_helpers.ts'))
    cpSync(path.join(acceptance, `${pairId}.test.ts`), path.join(target, `${pairId}.test.ts`))
    const tests = await runVitest(dir, 'src/__acceptance__/')
    const rules = JSON.parse(readFileSync(path.join(acceptance, 'contract.json'), 'utf8')) as ContractRules
    const contractViolations: string[] = []
    for (const file of consumerFiles.filter((name) => !/\.test\.tsx?$/.test(name) && repo.listFiles().includes(name))) {
      const content = repo.fileContent(file)
      for (const pattern of [...rules.generic, ...(rules.pairs[pairId]?.[file] ?? [])]) {
        if (new RegExp(pattern).test(content)) {
          contractViolations.push(`${file}: ${pattern}`)
        }
      }
    }
    return { ...tests, contractViolations }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export function runVitest(dir: string, filter?: string): Promise<FixtureTestResult> {
  const vitest = path.join(workspaceRoot(), 'node_modules', '.bin', 'vitest')
  return new Promise((resolve) => {
    execFile(vitest, ['run', ...(filter ? [filter] : []), '--root', dir, '--reporter=json', '--passWithNoTests'], { cwd: dir, timeout: 120_000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      const json = parseVitestJson(stdout)
      if (json) {
        resolve({ ok: json.success && !error, passed: json.numPassedTests, failed: json.numFailedTests, output: stderr.slice(-4000) })
        return
      }
      resolve({ ok: false, passed: 0, failed: 0, output: `${error?.message ?? ''}\n${stdout.slice(-2000)}\n${stderr.slice(-4000)}` })
    })
  })
}

function parseVitestJson(stdout: string): { success: boolean; numPassedTests: number; numFailedTests: number } | undefined {
  const start = stdout.indexOf('{')
  if (start === -1) {
    return undefined
  }
  try {
    const parsed = JSON.parse(stdout.slice(start)) as { success?: boolean; numPassedTests?: number; numFailedTests?: number }
    return { success: parsed.success === true, numPassedTests: parsed.numPassedTests ?? 0, numFailedTests: parsed.numFailedTests ?? 0 }
  } catch {
    return undefined
  }
}

export function listSourceFiles(root: string): string[] {
  if (!existsSync(root)) {
    return []
  }
  return readdirSync(root)
    .flatMap((entry) => {
      const file = path.join(root, entry)
      return statSync(file).isDirectory() ? listSourceFiles(file) : [file]
    })
    .filter((file) => file.endsWith('.ts') || file.endsWith('.tsx'))
    .sort()
}

/**
 * Scalability benchmark of the semantic layer on real public TypeScript repositories of increasing size.
 *
 * For each repository (pinned commit) the source tree is laid out as `<layout>/src/...` through symlinks and loaded
 * with the same path the runtime uses for on-disk projects (`repoFromDir` in fs-repo.ts), so the CRDT Repo holds every
 * .ts/.tsx file. Then it measures, with warm-up runs discarded and N timed repetitions (performance.now):
 *   - load: repoFromDir (Automerge Repo construction), plus save/load of the replica bytes;
 *   - fullRebuild: edit + SemanticIndex.build + semanticDiff + ImpactEngine.analyze (what MultiReplicaRuntime.observe does today);
 *   - incremental: edit + SemanticIndex.update(changed file) + semanticDiff + ImpactEngine.analyze;
 *   - breakdown: the stages of a full build (project creation, symbols, references, dependency graph, diagnostics).
 * The edit adds a required parameter to the exported function with the most importers (a breaking signature change).
 * Edits alternate between applying and reverting the change, so every repetition is a real signature change.
 * Each repository runs in its own child process (fresh heap, own peak RSS).
 *
 * Run (from the workspace root):
 *   npx tsx --tsconfig packages/eval/tsconfig.json packages/eval/src/bench-scale.ts --dir <work dir> --setup
 *   npx tsx --tsconfig packages/eval/tsconfig.json packages/eval/src/bench-scale.ts --dir <work dir> --out <file.json> \
 *     [--repos a,b] [--reps 30] [--warmup 5] [--load-reps 5] [--breakdown-reps 5]
 */
import { execFileSync, fork } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { createRequire } from 'node:module'

import { ImpactEngine } from '@hit/impact-engine'
import { Repo } from '@hit/repo-crdt'
import { SemanticIndex, semanticDiff } from '@hit/semantic-indexer'
import { ts as morphTs } from 'ts-morph'
import ts from 'typescript'

import { createProjectFromRepo } from '../../semantic-indexer/src/project.js'
import { collectSymbols } from '../../semantic-indexer/src/symbols.js'
import { collectReferences } from '../../semantic-indexer/src/references.js'
import { collectDependencies } from '../../semantic-indexer/src/internal-dependencies.js'
import { collectDiagnostics } from '../../semantic-indexer/src/diagnostics.js'
import { listSourceFiles, repoFromDir } from './fs-repo.js'
import { percentiles } from './metrics.js'
import { workspaceRoot } from './paths.js'

interface RepoSpec {
  name: string
  url: string
  commit: string
  /** [path inside the clone, path inside the layout's src/ ('' = src itself)] */
  roots: Array<[string, string]>
  note: string
}

/** Sizes target ~50, ~200, ~600 and ~2000 files. All four use extensionless relative imports, which Hit's resolver understands. */
export const REPOS: RepoSpec[] = [
  {
    name: 'trpc-client',
    url: 'https://github.com/trpc/trpc.git',
    commit: 'd756e591a5e37ef20b8d75ecd4d736c195497289',
    roots: [['packages/client/src', '']],
    note: 'tRPC client package (packages/client/src)',
  },
  {
    name: 'redux-toolkit',
    url: 'https://github.com/reduxjs/redux-toolkit.git',
    commit: '0fd611cc79d44990ac9a040dec4d5cb446233440',
    roots: [['packages/toolkit/src', '']],
    note: 'Redux Toolkit core package (packages/toolkit/src, includes its tests)',
  },
  {
    name: 'excalidraw',
    url: 'https://github.com/excalidraw/excalidraw.git',
    commit: '4c00f31ddcc20086bac1020428819fe0b9a30bce',
    roots: [['packages', '']],
    note: 'Excalidraw monorepo packages/ (all workspace packages, .ts and .tsx)',
  },
  {
    name: 'typeorm',
    url: 'https://github.com/typeorm/typeorm.git',
    commit: 'aa7934ad991739475a2c3189964ccbad61ef0945',
    roots: [['packages/typeorm/src', 'src']],
    note: 'TypeORM library source only (tests excluded to keep the measurement short)',
  },
]

interface Args {
  dir: string
  out?: string
  repos: string[]
  reps: number
  warmup: number
  loadReps: number
  breakdownReps: number
  setup: boolean
  worker?: string
  /** Files larger than this are left out of the layout (Automerge 2.2.9 Text overflows the stack applying patches of ~100 KB). */
  maxFileBytes: number
}

function parseArgs(argv: string[]): Args {
  const value = (flag: string): string | undefined => {
    const index = argv.indexOf(flag)
    return index === -1 ? undefined : argv[index + 1]
  }
  return {
    dir: path.resolve(value('--dir') ?? path.join(os.tmpdir(), 'hit-scale')),
    out: value('--out'),
    repos: (value('--repos') ?? REPOS.map((repo) => repo.name).join(',')).split(',').filter(Boolean),
    reps: Number(value('--reps') ?? 30),
    warmup: Number(value('--warmup') ?? 5),
    loadReps: Number(value('--load-reps') ?? 5),
    breakdownReps: Number(value('--breakdown-reps') ?? 5),
    setup: argv.includes('--setup'),
    maxFileBytes: Number(value('--max-file-bytes') ?? Infinity),
    worker: value('--worker'),
  }
}

function spec(name: string): RepoSpec {
  const found = REPOS.find((repo) => repo.name === name)
  if (!found) {
    throw new Error(`Unknown repo ${name}; known: ${REPOS.map((repo) => repo.name).join(', ')}`)
  }
  return found
}

const cloneName = (repo: RepoSpec): string => path.basename(repo.url, '.git')

/** Shallow-clone each repository at its pinned commit (or record HEAD when no commit is pinned). */
function setup(args: Args): void {
  const reposDir = path.join(args.dir, 'repos')
  mkdirSync(reposDir, { recursive: true })
  for (const repo of args.repos.map(spec)) {
    const target = path.join(reposDir, cloneName(repo))
    if (!existsSync(target)) {
      if (repo.commit) {
        mkdirSync(target, { recursive: true })
        execFileSync('git', ['init', '-q'], { cwd: target })
        execFileSync('git', ['remote', 'add', 'origin', repo.url], { cwd: target })
        execFileSync('git', ['fetch', '-q', '--depth', '1', 'origin', repo.commit], { cwd: target, stdio: 'inherit' })
        execFileSync('git', ['checkout', '-q', 'FETCH_HEAD'], { cwd: target })
      } else {
        execFileSync('git', ['clone', '-q', '--depth', '1', repo.url, target], { stdio: 'inherit' })
      }
    }
    const head = git(target, 'rev-parse', 'HEAD')
    if (repo.commit && head !== repo.commit) {
      throw new Error(`${repo.name}: checkout is at ${head}, expected pinned ${repo.commit}`)
    }
    console.error(`${repo.name}: ${head}`)
  }
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

/** Build `<dir>/layouts/<name>/src` from symlinks so repoFromDir (which reads `<dir>/src`) sees exactly the chosen roots. */
function layout(args: Args, repo: RepoSpec): string {
  const clone = path.join(args.dir, 'repos', cloneName(repo))
  const dir = path.join(args.dir, 'layouts', repo.name)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  for (const [from, to] of repo.roots) {
    const source = path.join(clone, from)
    if (!existsSync(source)) {
      throw new Error(`${repo.name}: missing ${source} (run --setup first)`)
    }
    const link = to === '' ? path.join(dir, 'src') : path.join(dir, 'src', to)
    linkFiles(source, link, args.maxFileBytes)
  }
  return dir
}

export const excludedLargeFiles: string[] = []

/** Mirror `source` into `target` with one symlink per file, skipping files above `maxBytes` (recorded in excludedLargeFiles). */
function linkFiles(source: string, target: string, maxBytes: number): void {
  mkdirSync(target, { recursive: true })
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name)
    const to = path.join(target, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') linkFiles(from, to, maxBytes)
    } else if (/\.tsx?$/.test(entry.name) && statSync(from).size > maxBytes) {
      excludedLargeFiles.push(from)
    } else {
      symlinkSync(from, to)
    }
  }
}

function gc(): void {
  ;(globalThis as { gc?: () => void }).gc?.()
}

function mem() {
  gc()
  const usage = process.memoryUsage()
  const mb = (bytes: number) => Math.round((bytes / 1024 / 1024) * 10) / 10
  return { rssMB: mb(usage.rss), heapUsedMB: mb(usage.heapUsed), heapTotalMB: mb(usage.heapTotal), externalMB: mb(usage.external), arrayBuffersMB: mb(usage.arrayBuffers) }
}

function stats(values: number[]) {
  const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1)
  const sd = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(values.length - 1, 1))
  const round = (value: number) => Math.round(value * 1000) / 1000
  const p = percentiles(values)
  return { n: values.length, p50: round(p.p50), p95: round(p.p95), min: round(p.min), max: round(p.max), mean: round(mean), sd: round(sd) }
}

interface Target {
  file: string
  name: string
  hitConsumers: number
  importers: number
  apply: { start: number; deleteCount: number; insert: string }
  revert: { start: number; deleteCount: number; insert: string }
}

/** Files importing `name` from `file`, resolving relative specifiers with .ts/.tsx/.js->.ts/index fallbacks (independent of Hit's resolver). */
function importersOf(repo: Repo, files: string[]): Map<string, Set<string>> {
  const fileSet = new Set(files)
  const result = new Map<string, Set<string>>()
  const resolve = (from: string, spec: string): string | undefined => {
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec))
    const stripped = base.replace(/\.(js|jsx|mjs)$/, '')
    for (const candidate of [base, `${stripped}.ts`, `${stripped}.tsx`, `${stripped}/index.ts`, `${stripped}/index.tsx`]) {
      if (fileSet.has(candidate)) return candidate
    }
    return undefined
  }
  for (const file of files) {
    const source = ts.createSourceFile(file, repo.fileContent(file), ts.ScriptTarget.Latest, false)
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
      const specifier = statement.moduleSpecifier.text
      if (!specifier.startsWith('.')) continue
      const target = resolve(file, specifier)
      const bindings = statement.importClause?.namedBindings
      if (!target || !bindings || !ts.isNamedImports(bindings)) continue
      for (const element of bindings.elements) {
        const key = `${target}#${(element.propertyName ?? element.name).text}`
        const set = result.get(key) ?? new Set<string>()
        set.add(file)
        result.set(key, set)
      }
    }
  }
  return result
}

/** Pick the exported, non-overloaded function with the most importers and prepare a breaking signature edit. */
function chooseTarget(repo: Repo, index: SemanticIndex): Target {
  const files = repo.listFiles()
  const importers = importersOf(repo, files)
  const candidates = index
    .symbols()
    .filter((symbol) => symbol.kind === 'function' && !/\.(test|spec)\.tsx?$/.test(symbol.file) && !symbol.file.endsWith('.d.ts'))
    .map((symbol) => ({ symbol, hit: index.consumersOf(symbol.id).length, importers: importers.get(symbol.id)?.size ?? 0 }))
    .sort((left, right) => right.importers - left.importers || right.hit - left.hit || left.symbol.id.localeCompare(right.symbol.id))

  for (const candidate of candidates) {
    const content = repo.fileContent(candidate.symbol.file)
    const source = ts.createSourceFile(candidate.symbol.file, content, ts.ScriptTarget.Latest, true)
    const declarations = source.statements.filter((statement): statement is ts.FunctionDeclaration => ts.isFunctionDeclaration(statement) && statement.name?.text === candidate.symbol.name)
    if (declarations.length !== 1) continue
    const params = declarations[0]!.parameters
    if (params.hasTrailingComma || params.some((param) => param.dotDotDotToken)) continue
    // Only ASCII before the insertion point: Automerge Text offsets and UTF-16 offsets then coincide.
    const insertion = params.length === 0 ? params.pos : params.end
    if (!/^[\x00-\x7f]*$/.test(content.slice(0, insertion))) continue
    const insert = params.length === 0 ? 'hitBenchExtra: number' : ', hitBenchExtra: number'
    return {
      file: candidate.symbol.file,
      name: candidate.symbol.name,
      hitConsumers: candidate.hit,
      importers: candidate.importers,
      apply: { start: insertion, deleteCount: 0, insert },
      revert: { start: insertion, deleteCount: insert.length, insert: '' },
    }
  }
  throw new Error('No suitable exported function to edit')
}

type Mode = 'fullRebuild' | 'incremental'

/** Timed pipeline loop: edit -> index (full build or incremental update) -> semantic diff -> impact analysis. */
function pipeline(repo: Repo, target: Target, mode: Mode, warmup: number, reps: number) {
  const impact = new ImpactEngine()
  const original = repo.fileContent(target.file)
  let previous = SemanticIndex.build(repo)
  let applied = false
  const edit: number[] = []
  const indexing: number[] = []
  const analysis: number[] = []
  const total: number[] = []
  let detected = 0
  const changedPerRep: number[] = []
  const conflictsPerRep: number[] = []
  let lastConflicts = 0
  let lastDiagnostics = 0

  for (let iteration = 0; iteration < warmup + reps; iteration += 1) {
    const change = applied ? target.revert : target.apply
    gc()
    const t0 = performance.now()
    repo.editFile(target.file, change)
    const t1 = performance.now()
    const next = mode === 'fullRebuild' ? SemanticIndex.build(repo) : previous.update(repo, [target.file])
    const t2 = performance.now()
    const diff = semanticDiff(previous, next)
    const conflicts = impact.analyze(diff, next)
    const t3 = performance.now()
    applied = !applied
    if (iteration >= warmup) {
      edit.push(t1 - t0)
      indexing.push(t2 - t1)
      analysis.push(t3 - t2)
      total.push(t3 - t0)
      if (diff.changed.some((change) => change.after.id === `${target.file}#${target.name}`)) detected += 1
      changedPerRep.push(diff.changed.length + diff.added.length + diff.removed.length)
      conflictsPerRep.push(conflicts.length)
    }
    lastConflicts = conflicts.length
    lastDiagnostics = next.diagnostics().length
    previous = next
  }
  if (applied) {
    repo.editFile(target.file, target.revert)
    applied = false
  }
  if (repo.fileContent(target.file) !== original) {
    throw new Error(`${mode}: target file content drifted after alternating edits`)
  }
  const memory = mem()
  return {
    warmup,
    reps,
    signatureChangeDetectedInReps: detected,
    changedSymbolsPerRep: stats(changedPerRep),
    conflictsPerRep: stats(conflictsPerRep),
    conflictsLastRep: lastConflicts,
    diagnosticsLastRep: lastDiagnostics,
    latencyMs: { edit: stats(edit), index: stats(indexing), diffAndImpact: stats(analysis), total: stats(total) },
    memoryAfter: memory,
  }
}

/** Stage breakdown of a full build, replicating SemanticIndex.fromProject with the indexer's own functions. */
function breakdown(repo: Repo, warmup: number, reps: number) {
  const stages: Record<string, number[]> = { readRepoContents: [], createProject: [], symbols: [], references: [], dependencies: [], diagnostics: [] }
  for (let iteration = 0; iteration < warmup + reps; iteration += 1) {
    gc()
    const t0 = performance.now()
    const files = repo.listFiles()
    for (const file of files) repo.fileContent(file)
    const t1 = performance.now()
    const project = createProjectFromRepo(repo)
    const t2 = performance.now()
    const fileSet = new Set(repo.listFiles())
    const sourceFiles = project.getSourceFiles()
    const symbols = sourceFiles.flatMap((sourceFile) => collectSymbols(sourceFile))
    const t3 = performance.now()
    const symbolIds = new Set(symbols.map((symbol) => symbol.id))
    sourceFiles.flatMap((sourceFile) => collectReferences(sourceFile, fileSet, symbolIds))
    const t4 = performance.now()
    collectDependencies(sourceFiles, fileSet)
    const t5 = performance.now()
    collectDiagnostics(project)
    const t6 = performance.now()
    if (iteration >= warmup) {
      stages.readRepoContents!.push(t1 - t0)
      stages.createProject!.push(t2 - t1)
      stages.symbols!.push(t3 - t2)
      stages.references!.push(t4 - t3)
      stages.dependencies!.push(t5 - t4)
      stages.diagnostics!.push(t6 - t5)
    }
  }
  return Object.fromEntries(Object.entries(stages).map(([stage, values]) => [stage, stats(values)]))
}

function progress(name: string, message: string): void {
  console.error(`[bench-scale] ${name}: ${message} (${new Date().toISOString()})`)
}

function runWorker(args: Args, name: string): unknown {
  const repo = spec(name)
  const clone = path.join(args.dir, 'repos', cloneName(repo))
  const dir = layout(args, repo)
  const started = performance.now()
  const memoryStart = mem()

  const diskFiles = listSourceFiles(path.join(dir, 'src'))
  const loadTimes: number[] = []
  let loaded: Repo | undefined
  for (let iteration = 0; iteration < Math.max(args.loadReps, 1) + 1; iteration += 1) {
    loaded = undefined
    gc()
    const t0 = performance.now()
    const candidate = repoFromDir(dir, 'bench-scale')
    const elapsed = performance.now() - t0
    if (iteration > 0) loadTimes.push(elapsed) // first load is warm-up
    loaded = candidate
  }
  const hitRepo = loaded!
  progress(name, `loaded ${diskFiles.length} files, repoFromDir p50 ${Math.round(percentiles(loadTimes).p50)} ms`)
  const memoryAfterLoad = mem()
  const t0 = performance.now()
  const bytes = hitRepo.save()
  const saveMs = performance.now() - t0
  const t1 = performance.now()
  Repo.load('bench-scale-b', bytes)
  const loadBytesMs = performance.now() - t1

  const files = hitRepo.listFiles()
  let characters = 0
  let lines = 0
  for (const file of files) {
    const content = hitRepo.fileContent(file)
    characters += content.length
    lines += content.split('\n').length
  }

  gc()
  const tb = performance.now()
  const index = SemanticIndex.build(hitRepo)
  const firstBuildMs = performance.now() - tb
  const memoryAfterFirstBuild = mem()
  const symbols = index.symbols()
  const references = symbols.reduce((sum, symbol) => sum + index.consumersOf(symbol.id).length, 0)
  const graph = index.dependencyGraph()
  const edges = [...graph.values()].reduce((sum, set) => sum + set.size, 0)
  const target = chooseTarget(hitRepo, index)
  progress(name, `first build ${Math.round(firstBuildMs)} ms, ${symbols.length} symbols, target ${target.file}#${target.name}`)
  // Stability check: a second full build of the unchanged repo should produce an empty semantic diff.
  const noopIndex = SemanticIndex.build(hitRepo)
  const noopDiff = semanticDiff(index, noopIndex)
  const noopConflicts = new ImpactEngine().analyze(noopDiff, noopIndex)
  const noopIncremental = index.update(hitRepo, [target.file])
  const noopIncrementalDiff = semanticDiff(noopIndex, noopIncremental)
  const kinds: Record<string, number> = {}
  for (const symbol of symbols) kinds[symbol.kind] = (kinds[symbol.kind] ?? 0) + 1

  progress(name, 'running fullRebuild, incremental and breakdown loops')
  const result = {
    repo: { name: repo.name, url: repo.url, commit: git(clone, 'rev-parse', 'HEAD'), roots: repo.roots, note: repo.note, excludedLargeFiles: excludedLargeFiles.length, maxFileBytes: args.maxFileBytes },
    size: {
      filesOnDisk: diskFiles.length,
      filesInRepo: files.length,
      tsxFiles: files.filter((file) => file.endsWith('.tsx')).length,
      declarationFiles: files.filter((file) => file.endsWith('.d.ts')).length,
      lines,
      characters,
      symbols: symbols.length,
      symbolKinds: kinds,
      hitReferences: references,
      dependencyEdges: edges,
      diagnosticsBaseline: index.diagnostics().length,
      crdtBytes: bytes.length,
    },
    target: { file: target.file, function: target.name, importers: target.importers, hitConsumers: target.hitConsumers, edit: `insert ${JSON.stringify(target.apply.insert)} into the parameter list` },
    noopRebuild: {
      fullChangedSymbols: noopDiff.changed.map((change) => change.after.id).concat(noopDiff.added.map((symbol) => `+${symbol.id}`), noopDiff.removed.map((symbol) => `-${symbol.id}`)),
      fullConflicts: noopConflicts.length,
      incrementalVsFullChangedSymbols: noopIncrementalDiff.changed.length + noopIncrementalDiff.added.length + noopIncrementalDiff.removed.length,
    },
    load: { repoFromDirMs: stats(loadTimes), saveMs: Math.round(saveMs * 1000) / 1000, loadFromBytesMs: Math.round(loadBytesMs * 1000) / 1000 },
    firstBuildMs: Math.round(firstBuildMs * 1000) / 1000,
    modes: {
      fullRebuild: pipeline(hitRepo, target, 'fullRebuild', args.warmup, args.reps),
      incremental: pipeline(hitRepo, target, 'incremental', args.warmup, args.reps),
    },
    fullBuildBreakdownMs: args.breakdownReps > 0 ? breakdown(hitRepo, 1, args.breakdownReps) : undefined,
    memory: { start: memoryStart, afterLoad: memoryAfterLoad, afterFirstBuild: memoryAfterFirstBuild, peakRssMB: Math.round(process.resourceUsage().maxRSS / 1024) },
    gcExposed: typeof (globalThis as { gc?: unknown }).gc === 'function',
    wallClockS: Math.round((performance.now() - started) / 100) / 10,
  }
  return result
}

function environment() {
  const require = createRequire(path.join(workspaceRoot(), 'package.json'))
  const version = (pkg: string) => {
    try {
      return (JSON.parse(readFileSync(require.resolve(`${pkg}/package.json`), 'utf8')) as { version: string }).version
    } catch {
      return 'unknown'
    }
  }
  let automerge = 'unknown'
  for (const candidate of [path.join(workspaceRoot(), 'packages/repo-crdt/node_modules/@automerge/automerge/package.json'), path.join(workspaceRoot(), 'node_modules/@automerge/automerge/package.json')]) {
    if (automerge === 'unknown' && existsSync(candidate)) {
      automerge = (JSON.parse(readFileSync(candidate, 'utf8')) as { version: string }).version
    }
  }
  const cpus = os.cpus()
  return {
    cpu: cpus[0]?.model.trim(),
    logicalCores: cpus.length,
    totalMemGB: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    freeMemGBAtStart: Math.round((os.freemem() / 1024 ** 3) * 10) / 10,
    loadAvgAtStart: os.loadavg().map((value) => Math.round(value * 100) / 100),
    os: `${os.type()} ${os.release()} (${os.platform()}/${os.arch()})`,
    node: process.version,
    typescriptWorkspace: version('typescript'),
    typescriptUsedByTsMorph: morphTs.version,
    tsMorph: version('ts-morph'),
    automerge,
    hitCommit: (() => {
      try {
        return git(workspaceRoot(), 'rev-parse', 'HEAD')
      } catch {
        return 'unknown'
      }
    })(),
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (args.worker) {
    const result = runWorker(args, args.worker)
    process.send?.(result)
    return
  }
  if (args.setup) {
    setup(args)
    return
  }
  const startedAt = new Date().toISOString()
  const env = environment()
  const results: unknown[] = []
  for (const name of args.repos) {
    spec(name)
    console.error(`[bench-scale] ${name}: reps=${args.reps} warmup=${args.warmup} load-reps=${args.loadReps} breakdown-reps=${args.breakdownReps}`)
    const result = await new Promise<unknown>((resolve) => {
      const child = fork(process.argv[1]!, [...process.argv.slice(2), '--worker', name], {
        execArgv: [...process.execArgv, '--expose-gc', '--max-old-space-size=8192'],
        stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
      })
      let message: unknown
      child.on('message', (data) => {
        message = data
      })
      child.on('exit', (code) => resolve(message ?? { repo: { name }, error: `worker exited with code ${code}` }))
    })
    console.error(`[bench-scale] ${name}: done ${JSON.stringify((result as { wallClockS?: number }).wallClockS ?? result)}`)
    results.push(result)
  }
  const output = {
    benchmark: 'hit semantic layer scalability on real TypeScript repositories',
    startedAt,
    finishedAt: new Date().toISOString(),
    parameters: { reps: args.reps, warmup: args.warmup, loadReps: args.loadReps, breakdownReps: args.breakdownReps, percentileMethod: 'nearest-rank floor (metrics.ts percentiles)' },
    environment: env,
    results,
  }
  const json = JSON.stringify(output, null, 2)
  if (args.out) {
    mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true })
    writeFileSync(args.out, `${json}\n`)
    console.error(`[bench-scale] wrote ${args.out}`)
  } else {
    console.log(json)
  }
}

if (process.argv[1]?.endsWith('bench-scale.ts')) {
  void main()
}

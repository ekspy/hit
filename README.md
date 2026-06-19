# Hit

A CRDT-based versioning and coordination substrate for concurrent agentic coding.
Multiple agents edit a shared codebase: structural convergence is guaranteed by a replicated document, while a derived semantic layer detects and propagates the impact of concurrent changes before integration.

Vertical-slice prototype for my undergraduate thesis.

## Architecture

The CRDT holds only the source of truth (files, tasks, claims).
Symbols, references, dependencies and conflicts are derived views, recomputed deterministically from the converged state, so they converge without extra synchronization.

- `repo-crdt` — Automerge-backed replicated repository
- `semantic-indexer` — ts-morph symbol / reference / dependency index
- `impact-engine` — semantic conflict detection (rules R1–R9)
- `coordinator` — observation-driven runtime and events
- `agent` — agent interface, scripted agents, LLM stub
- `cli` — `hit` command-line interface
- `eval` — labeled scenarios, metrics, reports

## Usage

```sh
pnpm install
pnpm test          # unit + property (convergence) tests
pnpm typecheck
pnpm eval          # regenerates reports/
pnpm --filter @hit/cli run dev -- run 01-return-type-change --agents scripted
```

## Stack

TypeScript, Automerge (CRDT core), ts-morph (semantic analysis), Vitest.

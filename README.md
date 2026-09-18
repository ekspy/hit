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
- `agent` — agent interface, scripted agents, LLM agents (Anthropic / OpenAI / Google providers)
- `cli` — `hit` command-line interface
- `eval` — 16 labeled scenarios, task pairs, real git worktree baseline, mode 1/2 experiment runners, reports

## Usage

```sh
pnpm install
pnpm test          # unit + property (convergence) tests
pnpm typecheck
pnpm eval          # regenerates reports/ (convergence, detector quality, latency)
pnpm --filter @hit/cli run dev -- run 01-return-type-change --agents scripted

# Experiments with real LLM agents (keys in .env: OPENAI_API_KEY, GEMINI_API_KEY, ANTHROPIC_API_KEY or `ant auth login`)
pnpm eval:smoke                                   # one cheap run per available model
pnpm eval:mode1 --models gpt-5.6-terra            # scripted breaking change + LLM repair, hit vs git (real worktrees)
pnpm eval:mode2 --models gpt-5.6-terra            # two LLM agents on colliding natural-language tasks
pnpm eval:mode1 --aggregate-only                  # rebuild reports/mode1.{json,md} from reports/runs/
# flags: --models a,b --reps N --scenarios 01,03 --conditions hit,git --concurrency 4 --budget 15 --dry-run
```

Transcripts of every run are written to `reports/runs/<mode>/<model>/<scenario>/<condition>/<rep>.json`.
Gemini free-tier keys are limited to 250 requests/day per model; use `--concurrency 2` and a paid project for full batches.

## Stack

TypeScript, Automerge (CRDT core), ts-morph (semantic analysis), Vitest.

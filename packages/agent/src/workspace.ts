import type { Repo, TextEdit } from '@hit/repo-crdt'
import { SemanticIndex, type Diagnostic } from '@hit/semantic-indexer'

/** What an LLM agent can see and touch. Backed by the agent's own replica (or a Repo loaded from a git worktree). */
export interface Workspace {
  listFiles(): string[]
  readFile(path: string): string
  editFile(path: string, edit: TextEdit): void
  typecheck(): Diagnostic[]
}

export class RepoWorkspace implements Workspace {
  constructor(readonly repo: Repo) {}

  listFiles(): string[] {
    return this.repo.listFiles()
  }

  readFile(path: string): string {
    return this.repo.fileContent(path)
  }

  editFile(path: string, edit: TextEdit): void {
    this.repo.editFile(path, edit)
  }

  typecheck(): Diagnostic[] {
    return SemanticIndex.build(this.repo).diagnostics()
  }
}

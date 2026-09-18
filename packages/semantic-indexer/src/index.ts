import { Repo } from '@hit/repo-crdt'
import type { Project } from 'ts-morph'

import { collectDependencies } from './internal-dependencies.js'
import { createProjectFromRepo, updateProjectFromRepo } from './project.js'
import { collectDiagnostics } from './diagnostics.js'
import { collectReferences } from './references.js'
import { collectSymbols } from './symbols.js'
import { semanticDiff } from './diff.js'
import type { Diagnostic, Reference, SymbolInfo } from './types.js'

export class SemanticIndex {
  private constructor(
    private readonly project: Project,
    private readonly symbolList: SymbolInfo[],
    private readonly referenceList: Reference[],
    private readonly graph: Map<string, Set<string>>,
    private readonly diagnosticList: Diagnostic[],
  ) {}

  static build(repo: Repo): SemanticIndex {
    const project = createProjectFromRepo(repo)
    return SemanticIndex.fromProject(project, repo)
  }

  private static fromProject(project: Project, repo: Repo): SemanticIndex {
    const files = new Set(repo.listFiles())
    const sourceFiles = project.getSourceFiles()
    const symbols = sourceFiles.flatMap((sourceFile) => collectSymbols(sourceFile))
    const references = sourceFiles.flatMap((sourceFile) => collectReferences(sourceFile, files, symbols))
    const graph = collectDependencies(sourceFiles, files)
    const diagnostics = collectDiagnostics(project)

    return new SemanticIndex(project, symbols, references, graph, diagnostics)
  }

  update(repo: Repo, changedPaths: string[]): SemanticIndex {
    updateProjectFromRepo(this.project, repo, changedPaths)
    return SemanticIndex.fromProject(this.project, repo)
  }

  symbols(): SymbolInfo[] {
    return [...this.symbolList].sort((left, right) => left.id.localeCompare(right.id))
  }

  symbolById(id: string): SymbolInfo | undefined {
    return this.symbolList.find((symbol) => symbol.id === id)
  }

  consumersOf(symbolId: string): Reference[] {
    return this.referenceList.filter((reference) => reference.symbolId === symbolId)
  }

  dependencyGraph(): Map<string, Set<string>> {
    return new Map([...this.graph].map(([file, dependencies]) => [file, new Set(dependencies)]))
  }

  diagnostics(): Diagnostic[] {
    return [...this.diagnosticList]
  }
}

export { semanticDiff }
export type { Diagnostic, Loc, ParameterInfo, Reference, SemanticDiff, SymbolChange, SymbolInfo, TypeShape } from './types.js'

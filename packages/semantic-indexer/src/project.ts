import { Repo } from '@hit/repo-crdt'
import { ModuleKind, ModuleResolutionKind, Project, ScriptTarget } from 'ts-morph'

export function createProjectFromRepo(repo: Repo): Project {
  const project = new Project({
    compilerOptions: {
      allowJs: false,
      jsx: 4,
      module: ModuleKind.ESNext,
      moduleResolution: ModuleResolutionKind.Bundler,
      noEmit: true,
      strict: true,
      target: ScriptTarget.ES2022,
    },
    skipAddingFilesFromTsConfig: true,
    useInMemoryFileSystem: true,
  })

  for (const file of repo.listFiles()) {
    project.createSourceFile(`/${file}`, repo.fileContent(file), { overwrite: true })
  }

  return project
}

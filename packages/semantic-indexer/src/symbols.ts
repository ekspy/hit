import {
  Node,
  type ClassDeclaration,
  type FunctionDeclaration,
  type InterfaceDeclaration,
  type SourceFile,
  type TypeAliasDeclaration,
  type VariableDeclaration,
} from 'ts-morph'

import { repoPath } from './dependencies.js'
import type { SymbolInfo, TypeShape } from './types.js'

export function collectSymbols(sourceFile: SourceFile): SymbolInfo[] {
  return [
    ...sourceFile.getFunctions().filter((node) => node.isExported()).map(functionSymbol),
    ...sourceFile.getClasses().filter((node) => node.isExported()).map(classSymbol),
    ...sourceFile.getInterfaces().filter((node) => node.isExported()).map(interfaceSymbol),
    ...sourceFile.getTypeAliases().filter((node) => node.isExported()).map(typeAliasSymbol),
    ...sourceFile
      .getVariableDeclarations()
      .filter((node) => Node.isVariableStatement(node.getVariableStatement()) && node.getVariableStatementOrThrow().isExported())
      .map(constSymbol),
  ]
}

function symbolId(file: string, name: string): string {
  return `${file}#${name}`
}

function locFile(node: FunctionDeclaration | ClassDeclaration | InterfaceDeclaration | TypeAliasDeclaration | VariableDeclaration): string {
  return repoPath(node.getSourceFile())
}

function functionSymbol(node: FunctionDeclaration): SymbolInfo {
  const file = locFile(node)
  const name = node.getName() ?? '<anonymous>'
  const returnType = node.getReturnType()

  return {
    id: symbolId(file, name),
    name,
    kind: 'function',
    file,
    signature: `${name}(${node.getParameters().map((param) => param.getText()).join(', ')}): ${returnType.getText(node)}`,
    returnShape: typeShape(returnType.getText(node), returnType.getProperties().map((property) => [property.getName(), property.getValueDeclaration()?.getType().getText(node) ?? 'unknown'])),
    exported: true,
  }
}

function classSymbol(node: ClassDeclaration): SymbolInfo {
  const file = locFile(node)
  const name = node.getName() ?? '<anonymous>'

  return {
    id: symbolId(file, name),
    name,
    kind: 'class',
    file,
    signature: `class ${name}`,
    exported: true,
  }
}

function interfaceSymbol(node: InterfaceDeclaration): SymbolInfo {
  const file = locFile(node)
  const name = node.getName()

  return {
    id: symbolId(file, name),
    name,
    kind: 'interface',
    file,
    signature: node.getText(),
    exported: true,
  }
}

function typeAliasSymbol(node: TypeAliasDeclaration): SymbolInfo {
  const file = locFile(node)
  const name = node.getName()

  return {
    id: symbolId(file, name),
    name,
    kind: 'type',
    file,
    signature: node.getText(),
    exported: true,
  }
}

function constSymbol(node: VariableDeclaration): SymbolInfo {
  const file = locFile(node)
  const name = node.getName()

  return {
    id: symbolId(file, name),
    name,
    kind: 'const',
    file,
    signature: `const ${name}: ${node.getType().getText(node)}`,
    exported: true,
  }
}

function typeShape(text: string, properties: Array<[string, string]>): TypeShape {
  return {
    text,
    properties: Object.fromEntries(properties.sort(([left], [right]) => left.localeCompare(right))),
  }
}

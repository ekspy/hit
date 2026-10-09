import {
  Node,
  SymbolFlags,
  type Type,
  type ClassDeclaration,
  type FunctionDeclaration,
  type InterfaceDeclaration,
  type ParameterDeclaration,
  type SourceFile,
  type TypeAliasDeclaration,
  type VariableDeclaration,
} from 'ts-morph'

import { repoPath } from './dependencies.js'
import type { ParameterInfo, SymbolInfo, TypeShape } from './types.js'

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

  const typeParameters = node.getTypeParameters().map((parameter) => {
    const constraint = parameter.getConstraint()?.getText()
    return { name: parameter.getName(), ...(constraint ? { constraint } : {}) }
  })
  const overloads = node.getOverloads().map((overload) => ({ text: callSignatureText(overload), arity: overload.getParameters().length }))
  const ownSignature = `${name}${typeParameterText(node)}(${node.getParameters().map((param) => param.getText()).join(', ')}): ${returnType.getText(node)}`

  return {
    id: symbolId(file, name),
    name,
    kind: 'function',
    file,
    signature: overloads.length > 0 ? [...overloads.map((overload) => `${name}${overload.text}`), ownSignature].join('; ') : ownSignature,
    returnShape: returnTypeShape(returnType, node),
    exported: true,
    parameters: node.getParameters().map((param) => parameterInfo(param)),
    returnTypeText: returnType.getText(node),
    ...(typeParameters.length > 0 ? { typeParameters } : {}),
    ...(overloads.length > 0 ? { overloads } : {}),
  }
}

function typeParameterText(node: FunctionDeclaration): string {
  const parameters = node.getTypeParameters()
  return parameters.length > 0 ? `<${parameters.map((parameter) => parameter.getText()).join(', ')}>` : ''
}

function callSignatureText(node: FunctionDeclaration): string {
  return `${typeParameterText(node)}(${node.getParameters().map((param) => param.getText()).join(', ')}): ${node.getReturnType().getText(node)}`
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
    shape: objectShape(node.getType(), node),
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
    shape: objectShape(node.getType(), node),
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

function parameterInfo(param: ParameterDeclaration): ParameterInfo {
  const type = param.getType()
  const typeText = param.getTypeNode()?.getText() ?? type.getText(param)
  const members = type.isUnion() ? type.getUnionTypes().map((member) => member.getText(param)) : [type.getText(param)]

  return {
    name: param.getName(),
    optional: param.isOptional(),
    typeText,
    unionMembers: [...new Set(members)].sort(),
  }
}

function returnTypeShape(returnType: Type, node: FunctionDeclaration): TypeShape | undefined {
  const unwrapped = unwrapPromise(returnType)

  if (
    unwrapped.isString() ||
    unwrapped.isNumber() ||
    unwrapped.isBoolean() ||
    unwrapped.isVoid() ||
    unwrapped.isUndefined() ||
    unwrapped.isNull() ||
    unwrapped.isNever()
  ) {
    return undefined
  }

  return objectShape(unwrapped, node)
}

/** `Promise<T>` contributes the shape of `T`; the async wrapper itself is captured by `returnTypeText`. */
function unwrapPromise(type: Type): Type {
  if (type.getSymbol()?.getName() === 'Promise') {
    return type.getTypeArguments()[0] ?? type
  }

  return type
}

function objectShape(type: Type, node: Node): TypeShape | undefined {
  const symbols = type.getProperties()
  const properties = symbols.map(
    (property) => [property.getName(), property.getValueDeclaration()?.getType().getText(node) ?? 'unknown'] as [string, string],
  )

  if (properties.length === 0) {
    return undefined
  }

  const optional = symbols
    .filter((property) => property.hasFlags(SymbolFlags.Optional))
    .map((property) => property.getName())
    .sort()

  return typeShape(type.getText(node), properties, optional)
}

function typeShape(text: string, properties: Array<[string, string]>, optional: string[]): TypeShape {
  const stable = properties.map(([name, type]) => [stableName(name), stableName(type)] as [string, string])
  return {
    text: stableName(text),
    properties: Object.fromEntries(stable.sort(([left], [right]) => left.localeCompare(right))),
    ...(optional.length > 0 ? { optional: optional.map(stableName).sort() } : {}),
  }
}

/**
 * The checker names symbol-keyed members `__@iterator@352`, with a numeric suffix that changes between builds of the same
 * program; without this, two builds of identical content would report a changed return shape (and spurious R1/R5 conflicts).
 */
function stableName(text: string): string {
  return text.replace(/__@([A-Za-z_$][\w$]*)@\d+/g, '[Symbol.$1]')
}

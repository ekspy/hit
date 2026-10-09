import { Node, type SourceFile, type Symbol as MorphSymbol, type Type } from 'ts-morph'

import { repoPath } from './dependencies.js'
import type { DiagnosticProducer } from './types.js'

/** How many local indirections (variable initializers, destructuring) are followed back to an imported declaration. */
const maxHops = 4

/**
 * Resolves the node a compiler diagnostic points at to the declaration, in another project file, whose contract the
 * consumer code is using there. The checker does the work: aliases (imports) are followed to their declaration, a call
 * argument is attributed to the callee, a member access to the member (or, when the member no longer exists, to the
 * object it is read from), and local variables and destructured bindings are followed back through their initializers,
 * so values that reach the consumer by inference across several files still land on the declaring file.
 */
export function resolveDiagnosticProducer(sourceFile: SourceFile, start: number, repoFiles: ReadonlySet<string>): DiagnosticProducer | undefined {
  const token = sourceFile.getDescendantAtPos(start)

  if (!token) {
    return undefined
  }

  const consumer = repoPath(sourceFile)
  const isProducer = (node: Node): boolean => {
    const file = repoPath(node.getSourceFile())
    return file !== consumer && repoFiles.has(file)
  }

  const importDeclaration = token.getFirstAncestor((node) => Node.isImportDeclaration(node))

  if (importDeclaration && Node.isImportDeclaration(importDeclaration)) {
    return importProducer(importDeclaration, token, consumer, repoFiles)
  }

  const statement = statementBoundary(token)

  // A diagnostic inside a call's argument list is about the callee's parameter contract.
  for (const call of token.getAncestors()) {
    if (statement && !statement.containsRange(call.getPos(), call.getEnd())) {
      break
    }

    if ((Node.isCallExpression(call) || Node.isNewExpression(call)) && (call.getArguments() ?? []).some((argument) => argument.containsRange(token.getPos(), token.getEnd()))) {
      // Only a callee declared in the repository is a contract the argument can violate; for library calls
      // (`rows.map(callback)`) the diagnostic is about the code inside the argument.
      const callee = declarationOf(calleeName(call.getExpression()).getSymbol())

      if (!callee || (!isProducer(callee) && repoPath(callee.getSourceFile()) !== consumer)) {
        continue
      }

      const producer = expressionProducer(call.getExpression(), isProducer, 0, 'call')

      if (producer) {
        return producer
      }
    }
  }

  for (const node of [token, ...token.getAncestors()]) {
    if (statement && !statement.containsRange(node.getPos(), node.getEnd())) {
      break
    }

    const producer = nodeProducer(node, isProducer)

    if (producer) {
      return producer
    }
  }

  return undefined
}

function calleeName(expression: Node): Node {
  return Node.isPropertyAccessExpression(expression) ? expression.getNameNode() : expression
}

function nodeProducer(node: Node, isProducer: (node: Node) => boolean): DiagnosticProducer | undefined {
  const parent = node.getParent()

  // Object literal property checked against a declared type: `{ tracking: { ... } }` assigned to `ShipmentOptions`.
  if (Node.isIdentifier(node) && parent && (Node.isPropertyAssignment(parent) || Node.isShorthandPropertyAssignment(parent)) && parent.getNameNode() === node) {
    const literal = parent.getParent()

    if (Node.isObjectLiteralExpression(literal)) {
      const declaration = literal.getContextualType()?.getProperty(node.getText())?.getDeclarations()[0]

      if (declaration && isProducer(declaration)) {
        return declarationProducer(declaration, 'reference')
      }
    }

    return undefined
  }

  if (Node.isIdentifier(node) || Node.isPropertyAccessExpression(node) || Node.isCallExpression(node) || Node.isNewExpression(node) || Node.isElementAccessExpression(node)) {
    return expressionProducer(node, isProducer, 0, 'reference')
  }

  return undefined
}

function expressionProducer(node: Node, isProducer: (node: Node) => boolean, hops: number, via: DiagnosticProducer['via']): DiagnosticProducer | undefined {
  if (hops > maxHops) {
    return undefined
  }

  if (Node.isParenthesizedExpression(node) || Node.isNonNullExpression(node) || Node.isAsExpression(node) || Node.isAwaitExpression(node) || Node.isSatisfiesExpression(node)) {
    return expressionProducer(node.getExpression(), isProducer, hops, via)
  }

  if (Node.isCallExpression(node) || Node.isNewExpression(node)) {
    return expressionProducer(node.getExpression(), isProducer, hops, via)
  }

  if (Node.isElementAccessExpression(node)) {
    return expressionProducer(node.getExpression(), isProducer, hops, via)
  }

  if (Node.isPropertyAccessExpression(node)) {
    // A member whose declared type depends on a type parameter of its container (`items: T[]` in `Page<T>`) gets its
    // concrete type from wherever the object was produced, so the object is followed instead of the member.
    const member = declarationOf(node.getNameNode().getSymbol())

    if (member && isProducer(member) && !involvesTypeParameter(member.getType())) {
      return declarationProducer(member, via)
    }

    // The member does not exist (removed or renamed): the broken contract is the declared type of the object.
    if (!member) {
      const objectType = node.getExpression().getType()
      const typeDeclaration = declarationOf(objectType.getAliasSymbol() ?? objectType.getSymbol())

      if (typeDeclaration && isProducer(typeDeclaration)) {
        return declarationProducer(typeDeclaration, via)
      }
    }

    return expressionProducer(node.getExpression(), isProducer, hops, via)
  }

  if (!Node.isIdentifier(node)) {
    return undefined
  }

  const parent = node.getParent()

  // `a.b` where `b` no longer exists: the member has no symbol, the contract is the object's.
  if (parent && Node.isPropertyAccessExpression(parent) && parent.getNameNode() === node) {
    const declaration = declarationOf(node.getSymbol())

    if (declaration && isProducer(declaration)) {
      return declarationProducer(declaration, via)
    }

    return declaration ? localProducer(declaration, isProducer, hops, via) : undefined
  }

  const declaration = declarationOf(node.getSymbol())

  if (!declaration) {
    return undefined
  }

  if (isProducer(declaration)) {
    return declarationProducer(declaration, via)
  }

  return localProducer(declaration, isProducer, hops, via)
}

/** Follows a declaration in the consumer file back to where its value comes from. */
function localProducer(declaration: Node, isProducer: (node: Node) => boolean, hops: number, via: DiagnosticProducer['via']): DiagnosticProducer | undefined {
  if (Node.isVariableDeclaration(declaration)) {
    const initializer = declaration.getInitializer()
    return initializer ? expressionProducer(initializer, isProducer, hops + 1, via) : undefined
  }

  if (Node.isBindingElement(declaration)) {
    const pattern = declaration.getParent()
    const owner = pattern?.getParent()
    const propertyName = declaration.getPropertyNameNode()?.getText() ?? declaration.getName()

    if (pattern && Node.isObjectBindingPattern(pattern)) {
      const member = pattern.getType().getProperty(propertyName)?.getDeclarations()[0]

      if (member && isProducer(member)) {
        return declarationProducer(member, via)
      }
    }

    if (owner && Node.isVariableDeclaration(owner)) {
      const initializer = owner.getInitializer()
      return initializer ? expressionProducer(initializer, isProducer, hops + 1, via) : undefined
    }
  }

  return undefined
}

function importProducer(importDeclaration: Node, token: Node, consumer: string, repoFiles: ReadonlySet<string>): DiagnosticProducer | undefined {
  if (!Node.isImportDeclaration(importDeclaration)) {
    return undefined
  }

  const target = importDeclaration.getModuleSpecifierSourceFile()

  if (!target) {
    return undefined
  }

  const file = repoPath(target)

  if (file === consumer || !repoFiles.has(file)) {
    return undefined
  }

  const specifier = Node.isImportSpecifier(token) ? token : token.getFirstAncestor((node) => Node.isImportSpecifier(node))

  if (specifier && Node.isImportSpecifier(specifier)) {
    return { file, symbol: specifier.getName(), via: 'import' }
  }

  const defaultImport = importDeclaration.getDefaultImport()

  if (defaultImport && defaultImport.containsRange(token.getPos(), token.getEnd())) {
    // A default import whose local name matches a named export of the module (the export changed form).
    const name = defaultImport.getText()
    return { file, ...(target.getExportedDeclarations().has(name) ? { symbol: name } : {}), via: 'import' }
  }

  return { file, via: 'import' }
}

function involvesTypeParameter(type: Type, depth = 0): boolean {
  if (depth > 3) {
    return false
  }

  if (type.isTypeParameter()) {
    return true
  }

  const element = type.getArrayElementType()

  return (
    (element !== undefined && involvesTypeParameter(element, depth + 1)) ||
    type.getTypeArguments().some((argument) => involvesTypeParameter(argument, depth + 1)) ||
    (type.isUnion() && type.getUnionTypes().some((member) => involvesTypeParameter(member, depth + 1)))
  )
}

function declarationOf(symbol: MorphSymbol | undefined): Node | undefined {
  if (!symbol) {
    return undefined
  }

  const resolved = symbol.isAlias() ? (symbol.getAliasedSymbol() ?? symbol) : symbol
  return resolved.getDeclarations()[0]
}

/** Top-level declaration name in the producer file, plus the member path inside it (`Item` + `quantity`). */
function declarationProducer(declaration: Node, via: DiagnosticProducer['via']): DiagnosticProducer {
  const file = repoPath(declaration.getSourceFile())
  const path: string[] = []
  let current: Node | undefined = declaration

  while (current && !Node.isSourceFile(current)) {
    const name = declarationName(current)

    if (name) {
      path.unshift(name)
    }

    current = current.getParent()
  }

  const [symbol, ...member] = path
  return { file, ...(symbol ? { symbol } : {}), ...(member.length > 0 ? { member: member.join('.') } : {}), via }
}

function declarationName(node: Node): string | undefined {
  if (
    Node.isFunctionDeclaration(node) ||
    Node.isClassDeclaration(node) ||
    Node.isInterfaceDeclaration(node) ||
    Node.isTypeAliasDeclaration(node) ||
    Node.isEnumDeclaration(node) ||
    Node.isVariableDeclaration(node) ||
    Node.isPropertySignature(node) ||
    Node.isPropertyDeclaration(node) ||
    Node.isMethodDeclaration(node) ||
    Node.isMethodSignature(node) ||
    Node.isEnumMember(node) ||
    Node.isGetAccessorDeclaration(node) ||
    Node.isSetAccessorDeclaration(node) ||
    Node.isPropertyAssignment(node)
  ) {
    return node.getName()
  }

  return undefined
}

function statementBoundary(token: Node): Node | undefined {
  return token.getFirstAncestor((node) => Node.isStatement(node))
}

/** Nearest function-like ancestor, used to relate a diagnostic that resolves to nothing to one in the same function. */
export function enclosingFunctionRange(sourceFile: SourceFile, start: number): { pos: number; end: number } | undefined {
  const token = sourceFile.getDescendantAtPos(start)
  const fn = token?.getFirstAncestor((node) => Node.isFunctionDeclaration(node) || Node.isMethodDeclaration(node) || Node.isArrowFunction(node) || Node.isFunctionExpression(node) || Node.isConstructorDeclaration(node))

  if (!fn) {
    return undefined
  }

  // Arrow callbacks inside a function belong to that function's body for this purpose.
  const outer = fn.getAncestors().filter((node) => Node.isFunctionDeclaration(node) || Node.isMethodDeclaration(node)).at(-1) ?? fn
  return { pos: outer.getStart(), end: outer.getEnd() }
}

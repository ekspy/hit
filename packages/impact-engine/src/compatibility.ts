import type { ParameterInfo, SymbolChange, SymbolInfo, TypeShape } from '@hit/semantic-indexer'

export type Compatibility = 'breaking' | 'compatible' | 'unknown'

export interface CompatibilityFinding {
  aspect: 'parameters' | 'return' | 'shape'
  verdict: Compatibility
  detail: string
}

export interface CompatibilityVerdict {
  classification: Compatibility
  findings: CompatibilityFinding[]
}

/**
 * Classifies a changed exported symbol by comparing the structured information
 * the semantic indexer derives from ts-morph (parameters, return type, shapes).
 *
 * Only structurally provable cases are decided; everything else is `unknown`,
 * which rules treat as breaking but tag so reports can show the uncertainty.
 */
export function classifyChange(change: SymbolChange): CompatibilityVerdict {
  const findings = [...parameterFindings(change), ...returnFindings(change), ...shapeFindings(change)]

  return { classification: overall(findings), findings }
}

export function parameterFindings(change: SymbolChange): CompatibilityFinding[] {
  const before = parametersOf(change.before)
  const after = parametersOf(change.after)

  if (!before || !after) {
    return []
  }

  const findings: CompatibilityFinding[] = []
  const shared = Math.min(before.length, after.length)

  for (let index = 0; index < shared; index += 1) {
    const previous = before[index]!
    const next = after[index]!

    if (previous.optional && !next.optional) {
      findings.push(finding('parameters', 'breaking', `parameter ${next.name} was optional and is now required`))
    } else if (!previous.optional && next.optional) {
      findings.push(finding('parameters', 'compatible', `parameter ${next.name} became optional`))
    }

    findings.push(...typeFindings('parameters', `parameter ${next.name}`, previous.unionMembers, next.unionMembers, 'parameter'))
  }

  for (const removed of before.slice(shared)) {
    findings.push(finding('parameters', 'breaking', `parameter ${removed.name} was removed`))
  }

  for (const added of after.slice(shared)) {
    findings.push(
      added.optional
        ? finding('parameters', 'compatible', `optional parameter ${added.name} was added`)
        : finding('parameters', 'breaking', `required parameter ${added.name} was added`),
    )
  }

  return findings
}

export function returnFindings(change: SymbolChange): CompatibilityFinding[] {
  const findings: CompatibilityFinding[] = []
  const beforeText = change.before.returnTypeText
  const afterText = change.after.returnTypeText

  if (beforeText !== undefined && afterText !== undefined && isPromise(beforeText) !== isPromise(afterText)) {
    findings.push(finding('return', 'breaking', isPromise(afterText) ? 'return became asynchronous (Promise)' : 'return became synchronous'))
  }

  findings.push(...shapeDiff('return', change.before.returnShape, change.after.returnShape))

  return findings
}

export function shapeFindings(change: SymbolChange): CompatibilityFinding[] {
  return shapeDiff('shape', change.before.shape, change.after.shape)
}

function shapeDiff(aspect: CompatibilityFinding['aspect'], before: TypeShape | undefined, after: TypeShape | undefined): CompatibilityFinding[] {
  if (!before || !after) {
    return []
  }

  const findings: CompatibilityFinding[] = []
  const afterOptional = new Set(after.optional ?? [])

  for (const [name, type] of Object.entries(before.properties)) {
    const next = after.properties[name]

    if (next === undefined) {
      findings.push(finding(aspect, 'breaking', `property ${name} was removed or renamed`))
      continue
    }

    findings.push(...typeFindings(aspect, `property ${name}`, unionMembersOf(type), unionMembersOf(next), 'property'))
  }

  for (const name of Object.keys(after.properties)) {
    if (!(name in before.properties)) {
      findings.push(
        afterOptional.has(name)
          ? finding(aspect, 'compatible', `optional property ${name} was added`)
          : finding(aspect, 'unknown', `required property ${name} was added`),
      )
    }
  }

  return findings
}

function typeFindings(
  aspect: CompatibilityFinding['aspect'],
  subject: string,
  before: string[],
  after: string[],
  position: 'parameter' | 'property',
): CompatibilityFinding[] {
  const previous = new Set(before)
  const next = new Set(after)

  if (setEquals(previous, next)) {
    return []
  }

  const widened = isSuperset(next, previous)
  const narrowed = isSuperset(previous, next)

  if (widened && position === 'parameter') {
    return [finding(aspect, 'compatible', `${subject} type widened from ${before.join(' | ')} to ${after.join(' | ')}`)]
  }

  if (narrowed) {
    return [finding(aspect, 'breaking', `${subject} type narrowed from ${before.join(' | ')} to ${after.join(' | ')}`)]
  }

  return [finding(aspect, 'unknown', `${subject} type changed from ${before.join(' | ')} to ${after.join(' | ')}`)]
}

function overall(findings: CompatibilityFinding[]): Compatibility {
  if (findings.some((item) => item.verdict === 'breaking')) {
    return 'breaking'
  }

  if (findings.some((item) => item.verdict === 'unknown') || findings.length === 0) {
    return 'unknown'
  }

  return 'compatible'
}

function parametersOf(symbol: SymbolInfo): ParameterInfo[] | undefined {
  if (symbol.parameters) {
    return symbol.parameters
  }

  if (symbol.kind !== 'function') {
    return undefined
  }

  return parseParameters(symbol.signature)
}

/** Fallback for symbols indexed without structured parameter info: parses the signature text. */
export function parseParameters(signature: string): ParameterInfo[] {
  const open = signature.indexOf('(')
  const close = signature.lastIndexOf(')')

  if (open === -1 || close === -1 || close < open) {
    return []
  }

  return splitTopLevel(signature.slice(open + 1, close), ',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const defaultAt = topLevelAssignmentIndex(part)
      const declaration = defaultAt === -1 ? part : part.slice(0, defaultAt)
      const [head, ...rest] = splitTopLevel(declaration, ':')
      const name = head!.trim().replace(/\?$/, '').replace(/^\.\.\./, '')
      const typeText = rest.join(':').trim() || 'unknown'

      return {
        name,
        optional: head!.trim().endsWith('?') || defaultAt !== -1,
        typeText,
        unionMembers: unionMembersOf(typeText),
      }
    })
}

export function unionMembersOf(typeText: string): string[] {
  return [...new Set(splitTopLevel(typeText, '|').map((member) => member.trim()).filter(Boolean))].sort()
}

/** Index of a top-level `=` that introduces a default value (ignores `=>`, `==`, `<=`, `>=`). */
function topLevelAssignmentIndex(text: string): number {
  let depth = 0
  let quote: string | undefined

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!

    if (quote) {
      if (char === quote) quote = undefined
      continue
    }

    if (char === "'" || char === '"' || char === '`') {
      quote = char
    } else if ('([{<'.includes(char)) {
      depth += 1
    } else if (')]}>'.includes(char)) {
      depth -= 1
    } else if (char === '=' && depth === 0 && text[index + 1] !== '>' && text[index + 1] !== '=' && !'<>!='.includes(text[index - 1] ?? '')) {
      return index
    }
  }

  return -1
}

function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  let quote: string | undefined

  for (const char of text) {
    if (quote) {
      current += char
      if (char === quote) quote = undefined
      continue
    }

    if (char === "'" || char === '"' || char === '`') {
      quote = char
    } else if ('([{<'.includes(char)) {
      depth += 1
    } else if (')]}>'.includes(char)) {
      depth -= 1
    } else if (char === separator && depth === 0) {
      parts.push(current)
      current = ''
      continue
    }

    current += char
  }

  parts.push(current)
  return parts
}

function isPromise(typeText: string): boolean {
  return /^Promise</.test(typeText.trim())
}

function finding(aspect: CompatibilityFinding['aspect'], verdict: Compatibility, detail: string): CompatibilityFinding {
  return { aspect, verdict, detail }
}

function setEquals<T>(left: Set<T>, right: Set<T>): boolean {
  return left.size === right.size && isSuperset(left, right)
}

function isSuperset<T>(superset: Set<T>, subset: Set<T>): boolean {
  for (const item of subset) {
    if (!superset.has(item)) {
      return false
    }
  }

  return true
}

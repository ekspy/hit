export interface Percentiles {
  min: number
  max: number
  p50: number
  p95: number
}

export function percentiles(values: number[]): Percentiles {
  const sorted = [...values].sort((left, right) => left - right)

  return {
    min: sorted[0] ?? 0,
    max: sorted.at(-1) ?? 0,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
  }
}

function percentile(sorted: number[], point: number): number {
  if (sorted.length === 0) {
    return 0
  }

  const index = Math.min(sorted.length - 1, Math.floor(point * (sorted.length - 1)))
  return sorted[index] ?? 0
}

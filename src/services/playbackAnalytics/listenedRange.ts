export type ListenRange = [number, number]

export function mergeRanges(ranges: readonly ListenRange[], start: number, end: number): ListenRange[] {
  if (!(end > start)) {
    return [...ranges]
  }
  const next = [...ranges, [start, end] as ListenRange].sort((left, right) => left[0] - right[0])
  const merged: ListenRange[] = []
  for (const span of next) {
    const last = merged[merged.length - 1]
    if (!last || span[0] > last[1]) {
      merged.push([span[0], span[1]])
      continue
    }
    if (span[1] > last[1]) {
      last[1] = span[1]
    }
  }
  return merged
}

export function rangesLength(ranges: readonly ListenRange[]): number {
  let total = 0
  for (const [start, end] of ranges) {
    if (end > start) {
      total += end - start
    }
  }
  return total
}

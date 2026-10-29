/**
 * Ограниченный пул промисов с сохранением порядка результатов.
 * concurrency=4: прячет latency, но не забивает лимит соединений к Яндексу
 * (обычно ~6 на host) и оставляет запас под resolve stream в плеере.
 */
export const CATALOG_PREPARE_CONCURRENCY = 4

export async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
  options?: {
    isCancelled?: () => boolean
    onInFlight?: (count: number) => void
  },
): Promise<R[]> {
  const results = new Array<R>(items.length)
  if (items.length === 0) {
    return results
  }

  const limit = Math.max(1, Math.min(concurrency, items.length))
  let nextIndex = 0
  let inFlight = 0

  async function worker(): Promise<void> {
    while (true) {
      if (options?.isCancelled?.()) {
        return
      }
      const index = nextIndex
      nextIndex += 1
      if (index >= items.length) {
        return
      }
      inFlight += 1
      options?.onInFlight?.(inFlight)
      try {
        results[index] = await mapper(items[index]!, index)
      } finally {
        inFlight -= 1
        options?.onInFlight?.(inFlight)
      }
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()))
  return results
}

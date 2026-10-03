import type { Category } from '../../types/category'
import type { LibraryStateDto } from './mapLibraryState.ts'

export type BootstrapClient = {
  load: () => Promise<LibraryStateDto>
  createCategory: (category: Category) => Promise<void>
}

/**
 * Один проход загрузки. Повторный вызов с тем же client не создаёт defaults,
 * если сервер уже вернул категории.
 */
export async function executeLibraryBootstrap(input: {
  isCurrent: () => boolean
  client: BootstrapClient
  createDefaults: () => Category[]
  apply: (state: LibraryStateDto) => void
}): Promise<'seeded' | 'hydrated' | 'stale'> {
  const first = await input.client.load()
  if (!input.isCurrent()) {
    return 'stale'
  }
  if (first.categories.length > 0) {
    input.apply(first)
    return 'hydrated'
  }

  const defaults = input.createDefaults()
  for (const category of defaults) {
    if (!input.isCurrent()) {
      return 'stale'
    }
    await input.client.createCategory(category)
  }
  if (!input.isCurrent()) {
    return 'stale'
  }
  const second = await input.client.load()
  if (!input.isCurrent()) {
    return 'stale'
  }
  input.apply(second.categories.length > 0 ? second : { ...second, categories: defaults })
  return 'seeded'
}

export function createBootstrapGate() {
  let generation = 0
  let flight: { userId: string; promise: Promise<void> } | null = null

  return {
    invalidate() {
      generation += 1
      flight = null
    },
    run(userId: string, task: (isCurrent: () => boolean) => Promise<void>) {
      if (flight?.userId === userId) {
        return flight.promise
      }
      const ticket = generation
      const promise = task(() => ticket === generation).finally(() => {
        if (flight?.promise === promise) {
          flight = null
        }
      })
      flight = { userId, promise }
      return promise
    },
  }
}

import type { PlaybackContext } from '../../types/playbackContext.ts'

export type CatalogExpandNavCommand = 'next' | 'previous'

type CatalogExpandGate = {
  generation: number
  catalogId: string
}

let gate: CatalogExpandGate | null = null
let pending: CatalogExpandNavCommand | null = null

/** Старт early-play stub: Next/Previous без соседа можно отложить. */
export function beginCatalogExpandGate(input: {
  generation: number
  catalogId: string
}): void {
  gate = {
    generation: input.generation,
    catalogId: input.catalogId,
  }
  pending = null
}

export function isCatalogExpandGateActive(input?: {
  generation?: number
  catalogId?: string
}): boolean {
  if (!gate) {
    return false
  }
  if (
    input?.generation !== undefined &&
    input.generation !== gate.generation
  ) {
    return false
  }
  if (input?.catalogId !== undefined && input.catalogId !== gate.catalogId) {
    return false
  }
  return true
}

/**
 * Отложить Next/Previous, пока stub не расширен.
 * Не останавливает текущий звук и не стартует новый catalog intent.
 */
export function tryDeferCatalogNav(
  command: CatalogExpandNavCommand,
): boolean {
  if (!gate) {
    return false
  }
  // Последняя команда побеждает (быстрые Next/Previous).
  pending = command
  return true
}

export function getDeferredCatalogNav(): CatalogExpandNavCommand | null {
  return pending
}

/** Смена сессии / отмена prepare — забыть отложенную навигацию. */
export function cancelCatalogExpandGate(): void {
  gate = null
  pending = null
}

function contextMatchesGate(context: PlaybackContext, catalogId: string): boolean {
  return context.type === 'playlist' && context.id === catalogId
}

export type CatalogExpandNavFlushDeps = {
  getContext: () => PlaybackContext
  runNext: () => Promise<void>
  runPrevious: () => Promise<void>
}

/**
 * Выполнить отложенный Next/Previous, не снимая gate
 * (соседи уже в очереди, полный expand ещё идёт).
 */
export async function flushDeferredCatalogNav(
  deps: CatalogExpandNavFlushDeps,
): Promise<CatalogExpandNavCommand | null> {
  if (!gate || !pending) {
    return null
  }
  const catalogId = gate.catalogId
  const command = pending
  pending = null
  if (!contextMatchesGate(deps.getContext(), catalogId)) {
    return null
  }
  if (command === 'next') {
    await deps.runNext()
  } else {
    await deps.runPrevious()
  }
  return command
}

/**
 * Expand завершён для этой generation: снять gate и выполнить отложенную
 * команду только если всё ещё тот же playlist-каталог.
 */
export async function completeCatalogExpandGate(
  generation: number,
  deps: CatalogExpandNavFlushDeps,
): Promise<CatalogExpandNavCommand | null> {
  if (!gate || gate.generation !== generation) {
    return null
  }
  const catalogId = gate.catalogId
  const command = pending
  gate = null
  pending = null
  if (!command) {
    return null
  }
  if (!contextMatchesGate(deps.getContext(), catalogId)) {
    return null
  }
  if (command === 'next') {
    await deps.runNext()
  } else {
    await deps.runPrevious()
  }
  return command
}

/** Сброс для unit-тестов. */
export function resetCatalogExpandNavigationForTests(): void {
  gate = null
  pending = null
}

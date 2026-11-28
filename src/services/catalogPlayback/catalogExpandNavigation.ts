import type { PlaybackContext } from '../../types/playbackContext.ts'

export type CatalogExpandNavCommand = 'next' | 'previous'

type CatalogExpandGate = {
  generation: number
  catalogId: string
}

type PendingCatalogExpandNav = {
  command: CatalogExpandNavCommand
  generation: number
  catalogId: string
}

let gate: CatalogExpandGate | null = null
let pending: PendingCatalogExpandNav | null = null

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

export type TryDeferCatalogNavDeps = {
  /** Актуальный playback context — чужая сессия не откладывает команду. */
  getContext?: () => PlaybackContext
}

/**
 * Отложить Next/Previous, пока stub не расширен.
 * Привязка к generation + catalogId gate; при смене сессии/контекста — cancel.
 * Не останавливает текущий звук и не стартует новый catalog intent.
 */
export function tryDeferCatalogNav(
  command: CatalogExpandNavCommand,
  deps?: TryDeferCatalogNavDeps,
): boolean {
  if (!gate) {
    return false
  }
  if (deps?.getContext) {
    const context = deps.getContext()
    if (!contextMatchesGate(context, gate.catalogId)) {
      cancelCatalogExpandGate()
      return false
    }
  }
  // Последняя команда побеждает (быстрые Next/Previous), с тем же owner.
  pending = {
    command,
    generation: gate.generation,
    catalogId: gate.catalogId,
  }
  return true
}

export function getDeferredCatalogNav(): CatalogExpandNavCommand | null {
  return pending?.command ?? null
}

export function getDeferredCatalogNavBinding(): PendingCatalogExpandNav | null {
  return pending ? { ...pending } : null
}

/** Смена сессии / отмена prepare — забыть отложенную навигацию. */
export function cancelCatalogExpandGate(): void {
  gate = null
  pending = null
}

function contextMatchesGate(context: PlaybackContext, catalogId: string): boolean {
  return context.type === 'playlist' && context.id === catalogId
}

function pendingMatchesGate(row: PendingCatalogExpandNav): boolean {
  return (
    gate !== null &&
    row.generation === gate.generation &&
    row.catalogId === gate.catalogId
  )
}

export type CatalogExpandNavFlushDeps = {
  getContext: () => PlaybackContext
  runNext: () => Promise<void>
  runPrevious: () => Promise<void>
  /**
   * Ожидаемая generation playUserCatalog — чужой/устаревший flush не играет.
   * Без поля используется generation из pending/gate.
   */
  expectedGeneration?: number
  /** Ожидаемый catalogId (playlist session owner). */
  expectedCatalogId?: string
}

function takePendingForFlush(
  deps: CatalogExpandNavFlushDeps,
): PendingCatalogExpandNav | null {
  if (!gate || !pending) {
    return null
  }
  if (!pendingMatchesGate(pending)) {
    pending = null
    return null
  }
  if (
    deps.expectedGeneration !== undefined &&
    deps.expectedGeneration !== pending.generation
  ) {
    return null
  }
  if (
    deps.expectedCatalogId !== undefined &&
    deps.expectedCatalogId !== pending.catalogId
  ) {
    return null
  }
  const context = deps.getContext()
  if (!contextMatchesGate(context, pending.catalogId)) {
    cancelCatalogExpandGate()
    return null
  }
  const row = pending
  pending = null
  return row
}

async function runPendingCommand(
  row: PendingCatalogExpandNav,
  deps: CatalogExpandNavFlushDeps,
): Promise<CatalogExpandNavCommand> {
  if (row.command === 'next') {
    await deps.runNext()
  } else {
    await deps.runPrevious()
  }
  return row.command
}

/**
 * Выполнить отложенный Next/Previous, не снимая gate
 * (соседи уже в очереди, полный expand ещё идёт).
 */
export async function flushDeferredCatalogNav(
  deps: CatalogExpandNavFlushDeps,
): Promise<CatalogExpandNavCommand | null> {
  const row = takePendingForFlush(deps)
  if (!row) {
    return null
  }
  return runPendingCommand(row, deps)
}

/**
 * Expand завершён для этой generation: снять gate и выполнить отложенную
 * команду только если всё ещё тот же playlist-каталог и та же generation.
 */
export async function completeCatalogExpandGate(
  generation: number,
  deps: CatalogExpandNavFlushDeps,
): Promise<CatalogExpandNavCommand | null> {
  if (!gate || gate.generation !== generation) {
    return null
  }
  const catalogId = gate.catalogId
  const row = pending
  gate = null
  pending = null
  if (!row) {
    return null
  }
  if (row.generation !== generation || row.catalogId !== catalogId) {
    return null
  }
  if (
    deps.expectedCatalogId !== undefined &&
    deps.expectedCatalogId !== row.catalogId
  ) {
    return null
  }
  if (!contextMatchesGate(deps.getContext(), row.catalogId)) {
    return null
  }
  return runPendingCommand(row, deps)
}

/** Сброс для unit-тестов. */
export function resetCatalogExpandNavigationForTests(): void {
  gate = null
  pending = null
}

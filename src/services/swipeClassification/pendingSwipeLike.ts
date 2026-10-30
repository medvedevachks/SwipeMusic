/**
 * Синхронный pending-like intent для LEFT → UP race.
 * Регистрируется до await сохранения; не означает успешный like.
 * Refcount: повторный LEFT до settle не снимает intent раньше времени.
 */

const pendingCounts = new Map<string, number>()

export function beginPendingSwipeLike(sourceTrackKey: string): void {
  if (!sourceTrackKey) {
    return
  }
  pendingCounts.set(
    sourceTrackKey,
    (pendingCounts.get(sourceTrackKey) ?? 0) + 1,
  )
}

export function hasPendingSwipeLike(sourceTrackKey: string): boolean {
  return (pendingCounts.get(sourceTrackKey) ?? 0) > 0
}

export function endPendingSwipeLike(sourceTrackKey: string): void {
  const next = (pendingCounts.get(sourceTrackKey) ?? 0) - 1
  if (next <= 0) {
    pendingCounts.delete(sourceTrackKey)
    return
  }
  pendingCounts.set(sourceTrackKey, next)
}

/** Сброс для unit-тестов. */
export function resetPendingSwipeLikesForTests(): void {
  pendingCounts.clear()
}

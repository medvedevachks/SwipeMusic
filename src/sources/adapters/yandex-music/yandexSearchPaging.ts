/**
 * Семантика неофициального Yandex /search (type=track):
 * - page — 0-based индекс страницы;
 * - total — заявленное число совпадений (поисковый индекс, не дискография);
 * - размер страницы API не зафиксирован контрактом → не угадываем «20».
 *
 * Cursor: `${page}:${fetchedSoFar}` после успешной страницы.
 */

export type YandexSearchCursor = {
  page: number
  fetched: number
}

export function parseYandexSearchCursor(
  cursor: string | null | undefined,
): YandexSearchCursor {
  if (!cursor || !cursor.trim()) {
    return { page: 0, fetched: 0 }
  }
  const [pageRaw, fetchedRaw] = cursor.split(':')
  const page = Number.parseInt(pageRaw ?? '0', 10)
  const fetched = Number.parseInt(fetchedRaw ?? '0', 10)
  return {
    page: Number.isFinite(page) && page > 0 ? page : 0,
    fetched: Number.isFinite(fetched) && fetched > 0 ? fetched : 0,
  }
}

export function formatYandexSearchCursor(page: number, fetched: number): string {
  return `${page}:${fetched}`
}

/**
 * Конец выдачи только по пустой странице или по total + фактически полученным трекам.
 * Не использует фиксированный pageSizeHint.
 */
export function resolveYandexSearchExhausted(input: {
  tracksOnPage: number
  total: number
  fetchedBefore: number
}): boolean {
  if (input.tracksOnPage <= 0) {
    return true
  }
  if (input.total > 0) {
    return input.fetchedBefore + input.tracksOnPage >= input.total
  }
  // total неизвестен/0: без пустой страницы конец не доказываем.
  return false
}

/**
 * Веса предпочтений. Это не похожесть треков и не жанр.
 * Явный лайк сильнее прослушивания. Дослушивание добавляет немного.
 * Ранний пропуск слабый. Техническая ошибка сюда не входит.
 */
export const TASTE_WEIGHTS = {
  explicitLike: 8,
  explicitDislike: -8,
  explicitHidden: -8,
  confirmedListen: 2,
  completion: 1,
  earlySkip: -1,
  weakSkip: -1,
  maxListenContribution: 4,
  maxCompletionContribution: 2,
  maxEarlySkipPenalty: -3,
  maxWeakSkipPenalty: -2,
} as const

export const TASTE_LIMITS = {
  maxEvents: 2_000,
  maxHistory: 200,
  recentActivity: 20,
} as const

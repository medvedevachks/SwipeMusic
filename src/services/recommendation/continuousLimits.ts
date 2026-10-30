/**
 * Лимиты continuous-random-v1.
 * Первые четыре — bounded. Общее число треков за сессию — без лимита.
 */
export const CONTINUOUS_LIMITS = {
  /** Размер одной страницы API. */
  apiPageSize: 20,
  /** Локальный candidate pool (не PlaybackQueue). */
  maxPoolSize: 48,
  /**
   * Prefetch buffer playable metadata (после probe), не raw discovery.
   * Target 10 / low-watermark 5 — PLAYBACK-CME-01.
   */
  bufferTarget: 10,
  /** Запуск refill, когда в буфере осталось ≤ этого числа. */
  bufferLowWatermark: 5,
  /** Скользящее окно недавних (не вечный blacklist). */
  recentWindow: 80,
  /** Макс. поисковых/feed страниц за одну refill-операцию (вкл. excluded-only pages). */
  maxPagesPerFill: 8,
  /** Макс. разных query за refill (не 10+ подряд). */
  maxQueriesPerFill: 4,
  /** Макс. probe playability за refill. */
  maxPlayableChecksPerFill: 28,
  /** Общий deadline одной операции подбора. */
  operationTimeoutMs: 5_000,
  /** Таймаут одной страницы. */
  pageTimeoutMs: 2_500,
  /** Параллельные запросы на один source. */
  maxConcurrentSourceRequests: 2,
  /** Пустые страницы подряд → lane exhausted. */
  maxEmptyLaneStreak: 2,
  /** Backoff при 429 / временных ошибках. */
  backoffBaseMs: 400,
  backoffMaxMs: 8_000,
  /** Сколько playable пытаемся собрать за один batch refill. */
  batchPlayableTarget: 10,
  /**
   * Мягкая доля familiar (canonical liked/favorite/in-catalog) в SWIPES batch.
   * Нехватка новых → допускается больше familiar (без голодания).
   */
  swipeFamiliarTargetRatio: 0.3,
} as const

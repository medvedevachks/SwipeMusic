import type { Track } from '../../../types/track.ts'
import { createTrack } from '../../normalizeTrack.ts'

export const DEV_ACCEPTANCE_SOURCE_ID = 'dev-acceptance'

/** Абсолютный URL на локальный WAV (relative path ломает PlaybackResolver). */
export function resolveDevAcceptanceAssetUrl(fileName: string): string {
  const path = `/dev-acceptance/${fileName}`
  try {
    if (typeof window !== 'undefined' && window.location?.origin) {
      return new URL(path, window.location.origin).href
    }
  } catch {
    // Node / SSR
  }
  return path
}

type CatalogSeed = {
  externalId: string
  title: string
  artist: string
  file: string
  durationMs: number
  coverColor: string
}

/**
 * Контролируемый каталог для приёмки рекомендаций:
 * - поиск «Сплин» → Seed / ATL / Recommendation 1–3;
 * - много треков других исполнителей (вкус / лайки вне выдачи);
 * - все с воспроизводимым WAV.
 */
const CATALOG_SEEDS: readonly CatalogSeed[] = [
  // --- Выдача «Сплин» ---
  {
    externalId: 'seed',
    title: 'Seed Song',
    artist: 'Сплин',
    file: 'seed.wav',
    durationMs: 8_000,
    coverColor: '#0f766e',
  },
  {
    externalId: 'atl',
    title: 'ATL',
    artist: 'Сплин',
    file: 'atl.wav',
    durationMs: 8_000,
    coverColor: '#1e3a5f',
  },
  {
    externalId: 'rec-1',
    title: 'Recommendation 1',
    artist: 'Сплин',
    file: 'rec1.wav',
    durationMs: 2_500,
    coverColor: '#b45309',
  },
  {
    externalId: 'rec-2',
    title: 'Recommendation 2',
    artist: 'Сплин',
    file: 'rec2.wav',
    durationMs: 2_500,
    coverColor: '#9f1239',
  },
  {
    externalId: 'rec-3',
    title: 'Recommendation 3',
    artist: 'Сплин',
    file: 'rec3.wav',
    durationMs: 2_500,
    coverColor: '#365314',
  },
  // --- Персональные / вне выдачи «Сплин» ---
  {
    externalId: 'kino-blood',
    title: 'Группа крови',
    artist: 'Кино',
    file: 'kino1.wav',
    durationMs: 3_000,
    coverColor: '#7c2d12',
  },
  {
    externalId: 'kino-star',
    title: 'Звезда по имени Солнце',
    artist: 'Кино',
    file: 'kino2.wav',
    durationMs: 3_000,
    coverColor: '#9a3412',
  },
  {
    externalId: 'zem-iskala',
    title: 'Искала',
    artist: 'Земфира',
    file: 'zem1.wav',
    durationMs: 3_000,
    coverColor: '#4c1d95',
  },
  {
    externalId: 'zem-snow',
    title: 'Хочешь',
    artist: 'Земфира',
    file: 'zem2.wav',
    durationMs: 3_000,
    coverColor: '#5b21b6',
  },
  {
    externalId: 'bi2-polkovnik',
    title: 'Полковнику никто не пишет',
    artist: 'Би-2',
    file: 'bi2-1.wav',
    durationMs: 3_000,
    coverColor: '#0e7490',
  },
  {
    externalId: 'bi2-serebro',
    title: 'Серебро',
    artist: 'Би-2',
    file: 'bi2-2.wav',
    durationMs: 3_000,
    coverColor: '#155e75',
  },
  {
    externalId: 'mt-vlad',
    title: 'Владивосток 2000',
    artist: 'Мумий Тролль',
    file: 'mt1.wav',
    durationMs: 3_000,
    coverColor: '#166534',
  },
  {
    externalId: 'mt-utra',
    title: 'Утекай',
    artist: 'Мумий Тролль',
    file: 'mt2.wav',
    durationMs: 3_000,
    coverColor: '#15803d',
  },
  {
    externalId: 'ddt-what',
    title: 'Что такое осень',
    artist: 'ДДТ',
    file: 'ddt1.wav',
    durationMs: 3_000,
    coverColor: '#1e40af',
  },
  {
    externalId: 'ddt-rain',
    title: 'Дождь',
    artist: 'ДДТ',
    file: 'ddt2.wav',
    durationMs: 3_000,
    coverColor: '#1d4ed8',
  },
  {
    externalId: 'nautilus-bound',
    title: 'Скованные одной цепью',
    artist: 'Наутилус Помпилиус',
    file: 'nau1.wav',
    durationMs: 3_000,
    coverColor: '#831843',
  },
  {
    externalId: 'agora-other',
    title: 'Other Hit',
    artist: 'Другой',
    file: 'other1.wav',
    durationMs: 3_000,
    coverColor: '#334155',
  },
]

export function buildDevAcceptanceCatalog(): Track[] {
  return CATALOG_SEEDS.map((seed) =>
    createTrack({
      sourceId: DEV_ACCEPTANCE_SOURCE_ID,
      externalId: seed.externalId,
      title: seed.title,
      artist: seed.artist,
      coverColor: seed.coverColor,
      previewUrl: resolveDevAcceptanceAssetUrl(seed.file),
      durationMs: seed.durationMs,
      album: 'DEV Acceptance',
    }),
  )
}

/** Треки вне поисковой выдачи «Сплин» (для asserts / docs). */
export function isDevAcceptanceSplinSearchHit(externalId: string): boolean {
  return ['seed', 'atl', 'rec-1', 'rec-2', 'rec-3'].includes(externalId)
}

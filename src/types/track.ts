export type Track = {
  /** Канонический id приложения: обычно `${sourceId}:${externalId}` */
  id: string
  sourceId: string
  externalId: string
  title: string
  artist: string
  album?: string
  durationMs?: number
  coverUrl?: string | null
  /** Заглушка / доминирующий цвет, если нет coverUrl */
  coverColor?: string
  previewUrl?: string | null
}

export type TrackSection = {
  id: string
  title: string
  tracks: Track[]
}

/** Сырые данные демо-библиотеки до нормализации адаптером. */
export type TrackSeed = {
  id: string
  title: string
  artist: string
  coverColor: string
}

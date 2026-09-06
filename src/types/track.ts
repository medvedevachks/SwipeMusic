export type Track = {
  /** Канонический id приложения: обычно `${sourceId}:${externalId}` */
  id: string
  sourceId: string
  externalId: string
  title: string
  artist: string
  album?: string
  genre?: string
  year?: number
  durationMs?: number
  coverUrl?: string | null
  /** Заглушка / доминирующий цвет, если нет coverUrl */
  coverColor?: string
  previewUrl?: string | null
  tags?: string[]
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
  previewUrl?: string
}

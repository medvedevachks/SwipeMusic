export type CatalogIconId =
  | 'heart'
  | 'car'
  | 'muscle'
  | 'moon'
  | 'party'
  | 'book'
  | 'music'
  | 'star'

/** Совместимое имя иконки. Тот же набор, что у каталога. */
export type CategoryIconId = CatalogIconId

/**
 * Каталог Swipe Music: контейнер пользователя, не плейлист провайдера.
 * Не содержит providerId и не принадлежит источнику. Треки внутри хранят свой sourceId.
 */
export type Catalog = {
  id: string
  name: string
  icon: CatalogIconId
  color: string
  description: string
  createdAt: string
  updatedAt: string
  sortOrder: number
  favorite: boolean
  /** Системные пресеты нельзя удалять без явного решения продукта. */
  system: boolean
}

/** Старое имя той же сущности. Отдельной модели Category нет. */
export type Category = Catalog

/**
 * Связь трека с каталогом.
 * `categoryId` — совместимое имя поля в API и SQLite; значение равно id каталога.
 */
export type TrackAssignment = {
  id: string
  trackId: string
  categoryId: string
  createdAt: string
}

export type LikedTrack = {
  trackId: string
  createdAt: string
}

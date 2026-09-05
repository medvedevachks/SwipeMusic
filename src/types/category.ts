export type CategoryIconId =
  | 'heart'
  | 'car'
  | 'muscle'
  | 'moon'
  | 'party'
  | 'book'
  | 'music'
  | 'star'

/**
 * Полноценная сущность категории.
 * Поля расширяемы; UI может использовать только name/icon/color.
 */
export type Category = {
  id: string
  name: string
  icon: CategoryIconId
  color: string
  description: string
  createdAt: string
  updatedAt: string
  sortOrder: number
  favorite: boolean
  /** Системные пресеты нельзя удалять без явного решения продукта. */
  system: boolean
}

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

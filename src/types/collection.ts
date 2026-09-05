import type { Category, LikedTrack, TrackAssignment } from './category'

/**
 * Агрегат пользовательской коллекции.
 * Store может хранить поля плоско; эта модель — каноническая форма домена.
 */
export type Collection = {
  id: string
  name: string
  categories: Category[]
  assignments: TrackAssignment[]
  likedTracks: LikedTrack[]
  createdAt: string
  updatedAt: string
}

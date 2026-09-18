export type CategoryIconId =
  | 'heart'
  | 'car'
  | 'muscle'
  | 'moon'
  | 'party'
  | 'book'
  | 'music'
  | 'star'

export type Category = {
  id: string
  name: string
  color: string
  icon: CategoryIconId
  createdAt: string
}

export type TrackAssignment = {
  id: string
  trackId: string
  categoryId: string
  createdAt: string
}

export type LikedTrack = {
  id: string
  trackId: string
  createdAt: string
}

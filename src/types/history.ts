export type TrackDecision = {
  id: string
  trackId: string
  action: 'like' | 'skip' | 'categorize'
  createdAt: string
}

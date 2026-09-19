import { describe, expect, it } from 'vitest'
import { defaultGestureConfig } from '../config/gestureConfig'
import { createDefaultCategories } from './defaultCategories'
import { snapshotFromStore, storeFromSnapshot } from './sync/merge'
import type { SourceTrack } from '../types/track'

describe('source track snapshot', () => {
  it('preserves zaycev metadata across snapshot roundtrip', () => {
    const categories = createDefaultCategories()
    const track: SourceTrack = {
      id: 'zaycev:99',
      sourceId: 'zaycev',
      externalId: '99',
      title: 'Песня',
      artist: 'Исполнитель',
      pageUrl: 'https://zaycev.net/pages/99.html',
      coverUrl: null,
      previewUrl: null,
      availability: 'unknown',
      playback: { embedded: false, externalOpen: true },
      addedAt: '2026-01-01T00:00:00.000Z',
    }

    const snapshot = snapshotFromStore({
      categories,
      assignments: [
        {
          id: 'asg_1',
          trackId: track.id,
          categoryId: categories[0]!.id,
          createdAt: track.addedAt,
        },
      ],
      likedTracks: [],
      sourceTracks: [track],
      viewedTrackIds: [],
      gestureConfig: defaultGestureConfig,
      decisions: [],
    })

    const restored = storeFromSnapshot(snapshot)
    expect(restored.sourceTracks[0]?.pageUrl).toBe(track.pageUrl)
    expect(restored.sourceTracks[0]?.title).toBe('Песня')
    expect(restored.assignments).toHaveLength(1)
  })
})

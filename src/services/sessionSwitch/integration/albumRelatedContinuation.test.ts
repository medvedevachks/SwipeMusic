/**
 * ALBUM related — same-artist library, hidden excluded.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { useCanonicalLibraryStore } from '../../../store/canonicalLibraryStore.ts'
import type { CanonicalLibraryItem } from '../../../types/canonical.ts'
import { buildAlbumRelatedTracks } from './albumRelatedTracks.ts'

function item(input: {
  id: string
  externalId: string
  title: string
  artist: string
  hidden?: boolean
}): CanonicalLibraryItem {
  const now = '2026-01-01T00:00:00.000Z'
  return {
    canonicalTrack: {
      id: input.id,
      title: input.title,
      artist: input.artist,
      album: null,
      durationMs: null,
      artworkUrl: null,
      createdAt: now,
      updatedAt: now,
    },
    copies: [
      {
        sourceTrackKey: `local:${input.externalId}`,
        canonicalTrackId: input.id,
        sourceId: 'local',
        externalId: input.externalId,
        title: input.title,
        artist: input.artist,
        album: null,
        durationMs: null,
        artworkUrl: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
    state: {
      addedAt: now,
      lastPlayed: null,
      playCount: 0,
      liked: true,
      likedAt: null,
      disliked: false,
      skipped: 0,
      notes: '',
      favorite: false,
      hidden: input.hidden ?? false,
      customMetadata: {},
    },
    catalogIds: [],
  }
}

describe('albumRelatedContinuation', () => {
  it('picks same artist and skips hidden', () => {
    useCanonicalLibraryStore.getState().clear()
    useCanonicalLibraryStore
      .getState()
      .replaceForUser('u1', [
        item({ id: 'can_a', externalId: '1', title: 'Hit', artist: 'Kino' }),
        item({
          id: 'can_h',
          externalId: '2',
          title: 'Secret',
          artist: 'Kino',
          hidden: true,
        }),
      ])

    const related = buildAlbumRelatedTracks({
      meta: {
        kind: 'album',
        albumId: 'alb',
        title: 'Blood',
        artist: 'Kino',
        phase: 'album',
      },
      lastTrack: {
        id: 'local:0',
        sourceId: 'local',
        externalId: '0',
        title: 'Seed',
        artist: 'Kino',
      },
      excludeIds: new Set(['local:0']),
    })
    assert.equal(related.length, 1)
    assert.equal(related[0]?.id, 'local:1')
  })
})

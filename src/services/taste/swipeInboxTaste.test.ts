import assert from 'node:assert/strict'
import test from 'node:test'
import { SYS_SWIPES_ID } from '../catalogs/systemFolders.ts'
import { buildUserTasteProfile } from './buildTasteProfile.ts'
import type { TasteInput } from './types.ts'
import { TASTE_WEIGHTS } from './weights.ts'

const NOW = '2024-06-01T00:00:00.000Z'

test('sys_swipes membership is not an extra taste catalog or second like', () => {
  const input: TasteInput = {
    catalogs: [
      { id: SYS_SWIPES_ID, name: 'Свайпы' },
      { id: 'cat_car', name: 'В машину' },
    ],
    library: [
      {
        canonicalTrackId: 'can_x',
        title: 'Город',
        artist: 'Север',
        liked: true,
        disliked: false,
        hidden: false,
        skipped: 0,
        playCount: 0,
        lastPlayed: null,
        catalogIds: [SYS_SWIPES_ID],
        copies: [
          {
            sourceId: 'yandex-music',
            externalId: '101',
            canonicalTrackId: 'can_x',
          },
        ],
      },
    ],
    stats: [],
    events: [],
    history: [],
  }
  const profile = buildUserTasteProfile('user-a', input, NOW)
  assert.equal(profile.catalogs.some((row) => row.catalogId === SYS_SWIPES_ID), false)
  assert.equal(profile.tracks.length, 1)
  assert.equal(profile.tracks[0]?.score, TASTE_WEIGHTS.explicitLike)
  const likeSignals = profile.tracks[0]?.signals.filter(
    (signal) => signal.origin === 'canonical-like' || signal.origin === 'history-like',
  )
  assert.equal(likeSignals?.length, 1)
})

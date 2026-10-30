import assert from 'node:assert/strict'
import test from 'node:test'
import { buildUserTasteProfile } from './buildTasteProfile.ts'
import type { TasteInput } from './types.ts'
import { TASTE_WEIGHTS } from './weights.ts'

const NOW = '2024-06-01T00:00:00.000Z'

/**
 * Документирует фактическую семантику: membership / categorize history
 * попадают в taste.catalogs и activity, но НЕ увеличивают track.score.
 * Recommendation Engine опирается на liked + scored tracks.
 * Новые веса без отдельного продуктового решения не вводим.
 */
test('user-catalog membership alone does not raise taste track score', () => {
  const input: TasteInput = {
    catalogs: [{ id: 'cat_party', name: 'Вечеринка' }],
    library: [
      {
        canonicalTrackId: 'can_x',
        title: 'Город',
        artist: 'Север',
        liked: false,
        disliked: false,
        hidden: false,
        skipped: 0,
        playCount: 0,
        lastPlayed: null,
        catalogIds: ['cat_party'],
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
    history: [
      {
        action: 'categorize',
        sourceId: 'yandex-music',
        externalId: '101',
        canonicalTrackId: 'can_x',
        catalogId: 'cat_party',
        createdAt: NOW,
      },
    ],
  }
  const profile = buildUserTasteProfile('user-a', input, NOW)
  assert.equal(profile.catalogs.length, 1)
  assert.equal(profile.catalogs[0]?.catalogId, 'cat_party')
  // Нет liked → нет explicitLike score; categorize не даёт отдельный вес.
  assert.equal(profile.tracks.length, 0)
})

test('liked plus catalog membership still has a single explicit like weight', () => {
  const input: TasteInput = {
    catalogs: [{ id: 'cat_party', name: 'Вечеринка' }],
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
        catalogIds: ['cat_party'],
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
  assert.equal(profile.tracks[0]?.score, TASTE_WEIGHTS.explicitLike)
  assert.equal(
    profile.tracks[0]?.signals.filter((row) => row.origin === 'canonical-like')
      .length,
    1,
  )
})

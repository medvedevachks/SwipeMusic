import { describe, expect, it } from 'vitest'
import { createMockMusicSourceAdapter } from '../sources/adapters/mock'
import { searchMusic } from './searchMusic'
import type { Track } from '../types/track'

describe('searchMusic', () => {
  it('finds a demo track by title', async () => {
    const results = await searchMusic('Midnight')
    expect(results.some((track) => track.title === 'Midnight Drive')).toBe(true)
  })

  it('includes saved library tracks', async () => {
    const local: Track[] = [
      {
        id: 'zaycev:1',
        sourceId: 'zaycev',
        externalId: '1',
        title: 'Моя песня',
        artist: 'Кто-то',
        pageUrl: 'https://zaycev.net/pages/1.html',
      },
    ]
    const results = await searchMusic('Моя', local)
    expect(results[0]?.id).toBe('zaycev:1')
  })

  it('does not search zaycev remotely', async () => {
    const adapter = createMockMusicSourceAdapter()
    expect(adapter.capabilities).toContain('search')
    const results = await searchMusic('zz top')
    expect(results.every((track) => track.sourceId !== 'zaycev' || track.title)).toBe(true)
  })
})

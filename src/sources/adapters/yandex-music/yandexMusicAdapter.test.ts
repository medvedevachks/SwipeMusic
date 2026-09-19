import { beforeEach, describe, expect, it } from 'vitest'
import { bootstrapMusicSources, hasCapability, musicSourceRegistry } from '../../index'
import { createYandexMusicSourceAdapter } from './yandexMusicAdapter'
import { YANDEX_MUSIC_SOURCE_ID } from '../../yandex-music/urlPolicy'
import { useCollectionStore } from '../../../store/collectionStore'

describe('yandex music source', () => {
  beforeEach(() => {
    bootstrapMusicSources()
    useCollectionStore.setState({
      sourceTracks: [],
      assignments: [],
      likedTracks: [],
    })
  })

  it('registers yandex-music in the shared registry', () => {
    expect(musicSourceRegistry.has(YANDEX_MUSIC_SOURCE_ID)).toBe(true)
    expect(musicSourceRegistry.get(YANDEX_MUSIC_SOURCE_ID).label).toBe('Яндекс Музыка')
  })

  it('does not claim unofficial search or playback', () => {
    const adapter = createYandexMusicSourceAdapter()
    expect(adapter.capabilities).toEqual(['externalOpen'])
    expect(hasCapability(adapter.capabilities, 'playback')).toBe(false)
    expect(hasCapability(adapter.capabilities, 'search')).toBe(false)
    expect(hasCapability(adapter.capabilities, 'auth')).toBe(false)
  })

  it('saves a valid track link into a catalog', () => {
    const adapter = createYandexMusicSourceAdapter()
    const track = adapter.createManualEntry!({
      title: 'Песня',
      artist: 'Исполнитель',
      pageUrl: 'https://music.yandex.ru/album/1/track/2',
    })
    const categoryId = useCollectionStore.getState().categories[0]!.id
    useCollectionStore.getState().addSourceTrackToCatalog(track, categoryId)
    expect(useCollectionStore.getState().sourceTracks).toHaveLength(1)
    expect(adapter.canPlay(track)).toBe(false)
  })

  it('rejects a non-yandex url', () => {
    const adapter = createYandexMusicSourceAdapter()
    expect(() =>
      adapter.createManualEntry?.({
        title: 'X',
        artist: 'Y',
        pageUrl: 'https://spotify.com/track/1',
      }),
    ).toThrow()
  })
})

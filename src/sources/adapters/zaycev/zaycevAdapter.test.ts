import { beforeEach, describe, expect, it } from 'vitest'
import { bootstrapMusicSources, hasCapability, musicSourceRegistry } from '../../index'
import { createZaycevMusicSourceAdapter } from './zaycevAdapter'
import { ZAYCEV_SOURCE_ID } from '../../zaycev/urlPolicy'
import { useCollectionStore } from '../../../store/collectionStore'

describe('zaycev source', () => {
  beforeEach(() => {
    bootstrapMusicSources()
    useCollectionStore.setState({
      sourceTracks: [],
      assignments: [],
      likedTracks: [],
    })
  })

  it('registers zaycev in the shared registry', () => {
    expect(musicSourceRegistry.has(ZAYCEV_SOURCE_ID)).toBe(true)
    expect(musicSourceRegistry.get(ZAYCEV_SOURCE_ID).label).toBe('Zaycev.net')
  })

  it('exposes only confirmed capabilities', () => {
    const adapter = createZaycevMusicSourceAdapter()
    expect(adapter.capabilities).toEqual(['externalOpen'])
    expect(hasCapability(adapter.capabilities, 'externalOpen')).toBe(true)
    expect(hasCapability(adapter.capabilities, 'playback')).toBe(false)
    expect(hasCapability(adapter.capabilities, 'search')).toBe(false)
    expect(hasCapability(adapter.capabilities, 'libraryImport')).toBe(false)
  })

  it('creates a manual entry from a valid link', () => {
    const adapter = createZaycevMusicSourceAdapter()
    const track = adapter.createManualEntry?.({
      title: 'Песня',
      artist: 'Исполнитель',
      pageUrl: 'https://zaycev.net/pages/99.html',
    })
    expect(track?.sourceId).toBe('zaycev')
    expect(track?.title).toBe('Песня')
    expect(track?.pageUrl).toBe('https://zaycev.net/pages/99.html')
    expect(track?.playback.embedded).toBe(false)
    expect(adapter.canPlay(track!)).toBe(false)
  })

  it('rejects a foreign domain', () => {
    const adapter = createZaycevMusicSourceAdapter()
    expect(() =>
      adapter.createManualEntry?.({
        title: 'X',
        artist: 'Y',
        pageUrl: 'https://evil.example/track',
      }),
    ).toThrow()
  })

  it('adds a track to a catalog without duplicates', () => {
    const adapter = createZaycevMusicSourceAdapter()
    const track = adapter.createManualEntry!({
      title: 'Песня',
      artist: 'Исполнитель',
      pageUrl: 'https://zaycev.net/pages/99.html',
    })
    const categoryId = useCollectionStore.getState().categories[0]!.id
    useCollectionStore.getState().addSourceTrackToCatalog(track, categoryId)
    useCollectionStore.getState().addSourceTrackToCatalog(track, categoryId)
    expect(useCollectionStore.getState().sourceTracks).toHaveLength(1)
    expect(
      useCollectionStore
        .getState()
        .assignments.filter((item) => item.trackId === track.id && item.categoryId === categoryId),
    ).toHaveLength(1)
  })

  it('removes a catalog assignment together with the library record', () => {
    const adapter = createZaycevMusicSourceAdapter()
    const track = adapter.createManualEntry!({
      title: 'Песня',
      artist: 'Исполнитель',
      pageUrl: 'https://zaycev.net/pages/99.html',
    })
    const categoryId = useCollectionStore.getState().categories[0]!.id
    useCollectionStore.getState().addSourceTrackToCatalog(track, categoryId)
    useCollectionStore.getState().removeSourceTrack(track.id)
    expect(useCollectionStore.getState().sourceTracks).toHaveLength(0)
    expect(useCollectionStore.getState().assignments).toHaveLength(0)
  })

  it('keeps saved tracks if the source adapter is later unavailable', () => {
    const adapter = createZaycevMusicSourceAdapter()
    const track = adapter.createManualEntry!({
      title: 'Песня',
      artist: 'Исполнитель',
      pageUrl: 'https://zaycev.net/pages/99.html',
    })
    useCollectionStore.getState().upsertSourceTrack(track)
    expect(adapter.isAvailable()).toBe(true)
    expect(useCollectionStore.getState().sourceTracks[0]?.title).toBe('Песня')
  })
})

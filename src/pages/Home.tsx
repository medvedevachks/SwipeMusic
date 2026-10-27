import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlbumModeBanner } from '../components/AlbumModeBanner'
import CategoryPickerSheet from '../components/CategoryPickerSheet'
import SwipeDeck from '../components/SwipeDeck'
import WaveStartCard from '../components/WaveStartCard'
import { useSwipeFeed } from '../hooks/useSwipeFeed'
import { getAudioPlayer } from '../services/audioPlayer'
import { commitCatalogChoice } from '../services/canonical/userOrganization.ts'
import {
  isSearchSeedPlaybackEnabled,
  searchDeckUsesSeedPlayback,
  sortingDeckFollowsPlayer,
} from '../services/continuation/index.ts'
import { getPlaybackIntent } from '../services/playbackIntent'
import {
  homeCardTracks,
  runCardPlay,
  waveHomeView,
  type HomeStage,
} from '../services/personalRadio/homeStage'
import { toggleLiveMyWave } from '../services/personalRadio/myWaveRuntime'
import { MY_WAVE_ID, shouldReplaceHomeQueueWithSwipeFeed } from '../services/personalRadio/recommend'
import { useCanonicalLibraryStore } from '../store/canonicalLibraryStore'
import { useCollectionStore } from '../store/collectionStore'
import { usePlayerStore } from '../store/playerStore'
import { useSourceManagerStore } from '../store/sourceManagerStore'
import { useSwipeDeckSessionStore } from '../store/swipeDeckSessionStore'
import { isDemoSourceId } from '../sources/demoSource'
import { isQueueLockedContext } from '../types/playbackContext'
import type { Track } from '../types/track'

export default function Home() {
  const { tracks, isLoading, error, mode, searchQuery } = useSwipeFeed()
  const resetToCatalog = useSwipeDeckSessionStore((state) => state.resetToCatalog)
  const gestureConfig = useCollectionStore((state) => state.gestureConfig)
  const categories = useCollectionStore((state) => state.categories)
  const createCategory = useCollectionStore((state) => state.createCategory)

  const setQueue = usePlayerStore((state) => state.setQueue)
  const currentTime = usePlayerStore((state) => state.currentTime)
  const duration = usePlayerStore((state) => state.duration)
  const playerError = usePlayerStore((state) => state.error)
  const seek = usePlayerStore((state) => state.seek)
  const currentTrack = usePlayerStore((state) => state.currentTrack)
  const pendingPlaybackTrack = usePlayerStore((state) => state.pendingTrack)
  const playbackContext = usePlayerStore((state) => state.playbackContext)
  const queue = usePlayerStore((state) => state.queue)
  const playing = usePlayerStore((state) => state.playing)
  const playerLoading = usePlayerStore((state) => state.loading || state.buffering)
  const queueLocked = isQueueLockedContext(playbackContext)
  const radioActive = playbackContext.type === 'radio' && playbackContext.id === MY_WAVE_ID
  const playerTrackId = (pendingPlaybackTrack ?? currentTrack)?.id ?? null
  const audibleTrackId =
    pendingPlaybackTrack && pendingPlaybackTrack.id !== currentTrack?.id
      ? null
      : (currentTrack?.id ?? null)
  const startingTrackId =
    pendingPlaybackTrack?.id ??
    (playerLoading && !playing ? (currentTrack?.id ?? null) : null)

  const [stage, setStage] = useState<HomeStage>(() =>
    usePlayerStore.getState().playbackContext.type === 'radio' ? 'wave' : 'sorting',
  )
  const [wavePending, setWavePending] = useState(false)
  const [waveNotice, setWaveNotice] = useState<string | null>(null)
  const [pendingTrack, setPendingTrack] = useState<Track | null>(null)
  const likedCount = useCanonicalLibraryStore((state) =>
    Object.values(state.itemsById).filter(
      (item) =>
        item.state.liked &&
        !item.state.disliked &&
        !item.state.hidden &&
        item.copies.some((copy) => !isDemoSourceId(copy.sourceId)),
    ).length,
  )
  const hasRealSource = useSourceManagerStore((state) =>
    state.sources.some((source) => source.enabled && !isDemoSourceId(source.id)),
  )
  const [categoryResolveKey, setCategoryResolveKey] = useState(0)
  const [categoryCancelKey, setCategoryCancelKey] = useState(0)

  const sortingTracks = useMemo(
    () =>
      homeCardTracks({
        stage: 'sorting',
        feed: tracks,
        radioQueue: [],
        radioActive: false,
      }),
    [tracks],
  )
  const waveTracks = useMemo(
    () =>
      homeCardTracks({
        stage: 'wave',
        feed: tracks,
        radioQueue: queue,
        radioActive,
      }),
    [tracks, queue, radioActive],
  )

  useEffect(() => {
    const feed = homeCardTracks({
      stage: 'sorting',
      feed: tracks,
      radioQueue: [],
      radioActive: false,
    })
    if (
      !shouldReplaceHomeQueueWithSwipeFeed({
        queueLocked,
        feedLength: feed.length,
        queueLength: usePlayerStore.getState().queue.length,
      })
    ) {
      return
    }
    setQueue(feed, 0, { type: 'swipe' })
  }, [tracks, setQueue, queueLocked])

  const playListedTrack = useCallback(
    (track: Track, list: readonly Track[], nextStage: HomeStage, intent: 'toggle' | 'advance' = 'toggle') => {
      const state = usePlayerStore.getState()
      const radioReady =
        state.playbackContext.type === 'radio' &&
        state.playbackContext.id === MY_WAVE_ID &&
        state.queue.length > 0
      void runCardPlay(
        {
          stage: nextStage,
          intent,
          cardId: track.id,
          currentId: state.currentTrack?.id ?? null,
          pendingId: state.pendingTrack?.id ?? null,
          playing: state.playing,
          radioReady,
        },
        {
          pause: () => usePlayerStore.getState().pause(),
          resume: () => usePlayerStore.getState().resume(),
          playSwipe: async () => {
            const session = useSwipeDeckSessionStore.getState()
            if (
              searchDeckUsesSeedPlayback({
                enabled: isSearchSeedPlaybackEnabled(),
                stage: nextStage,
                sessionMode: session.mode,
              })
            ) {
              await getPlaybackIntent().playSearchTrack({
                track,
                query: session.searchQuery ?? '',
              })
              return
            }
            const startIndex = list.findIndex((item) => item.id === track.id)
            if (startIndex < 0) {
              throw new Error('В ленте нет этой композиции')
            }
            await getPlaybackIntent().playFromSwipe({
              tracks: [...list],
              startIndex,
              explicitUserPlay: true,
            })
          },
          playRadio: async () => {
            const live = usePlayerStore.getState()
            if (
              live.playbackContext.type !== 'radio' ||
              !live.queue.some((item) => item.id === track.id)
            ) {
              throw new Error('Очередь волны не содержит эту композицию')
            }
            await getAudioPlayer().playTrack(track)
          },
          buildWave: async () => {
            const plan = await toggleLiveMyWave()
            if (plan.tracks.length === 0 && plan.status !== 'ready') {
              setWaveNotice(plan.message)
            }
          },
        },
      )
    },
    [],
  )

  const startWave = useCallback(() => {
    if (wavePending) {
      return
    }
    setWavePending(true)
    setWaveNotice(null)
    void toggleLiveMyWave()
      .then((plan) => {
        if (plan.tracks.length === 0 && plan.status !== 'ready') {
          setWaveNotice(plan.message)
        }
      })
      .catch(() => {
        setWaveNotice('Не удалось начать воспроизведение.')
      })
      .finally(() => {
        setWavePending(false)
      })
  }, [wavePending])

  const playSortingTrack = useCallback(
    (track: Track) => {
      playListedTrack(track, sortingTracks, 'sorting')
    },
    [playListedTrack, sortingTracks],
  )

  const playWaveTrack = useCallback(
    (track: Track) => {
      playListedTrack(track, waveTracks, 'wave')
    },
    [playListedTrack, waveTracks],
  )

  const navigateWaveTrack = useCallback(
    (track: Track) => {
      playListedTrack(track, waveTracks, radioActive ? 'wave' : 'sorting', 'advance')
    },
    [playListedTrack, radioActive, waveTracks],
  )

  const exitAlbumMode = useCallback(() => {
    const playerState = usePlayerStore.getState()
    getPlaybackIntent().exitAlbumMode({
      swipeTracks: sortingTracks,
      currentTrack: playerState.pendingTrack ?? playerState.currentTrack,
    })
  }, [sortingTracks])

  const deckKey =
    mode === 'search'
      ? `search:${searchQuery ?? ''}:${sortingTracks[0]?.id ?? 'empty'}`
      : `catalog:${sortingTracks[0]?.id ?? 'empty'}`

  const waveView = waveHomeView({
    radioActive,
    radioQueueLength: waveTracks.length,
    likedCount,
    hasRealSource,
  })
  const favoritesNote =
    radioActive && playbackContext.type === 'radio' && playbackContext.origin === 'favorites'
      ? 'Новых композиций нет. Играет сохранённое избранное, это не подборка рекомендаций.'
      : null

  const playback = {
    currentTime,
    duration,
    canSeek: Boolean(currentTrack),
    onSeek: seek,
    error: playerError,
  }

  return (
    <div className="space-y-3 pb-2">
      <div className="space-y-2 px-1">
        <div
          className="flex flex-wrap items-center justify-center gap-2 sm:justify-start"
          role="tablist"
          aria-label="Режим главной"
        >
          <button
            type="button"
            role="tab"
            aria-selected={stage === 'sorting'}
            className={[
              'h-11 rounded-full px-4 text-sm font-semibold',
              stage === 'sorting'
                ? 'bg-[var(--color-accent)] text-white'
                : 'border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-fg)]',
            ].join(' ')}
            onClick={() => setStage('sorting')}
          >
            Свайпы
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={stage === 'wave'}
            className={[
              'h-11 rounded-full px-4 text-sm font-semibold',
              stage === 'wave'
                ? 'bg-[var(--color-accent)] text-white'
                : 'border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-fg)]',
            ].join(' ')}
            onClick={() => setStage('wave')}
          >
            Моя волна
          </button>
        </div>
        <p className="text-center text-sm text-[var(--color-muted)] sm:text-left">
          {stage === 'wave'
            ? waveView === 'deck'
              ? 'Карточка показывает очередь волны. Свайпы лайкают её, открывают каталог и переключают треки.'
              : 'Play на карточке собирает волну из избранного.'
            : mode === 'search' && searchQuery
              ? `Результаты: «${searchQuery}»`
              : 'Свайп оценивает трек. Play на карточке включает именно его.'}
        </p>
        {stage === 'sorting' &&
        playerTrackId &&
        playbackContext.type !== 'swipe' &&
        playbackContext.type !== 'none' &&
        playbackContext.type !== 'search-seed' ? (
          <p className="text-center text-xs text-[var(--color-muted)] sm:text-left">
            {radioActive
              ? 'В плеере всё ещё играет «Моя волна». Play на карточке переключит очередь на свайпы.'
              : 'В плеере другая композиция. Play на карточке включит именно её.'}
          </p>
        ) : null}
        {stage === 'sorting' && mode === 'search' ? (
          <button
            type="button"
            className="rounded-xl border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-fg)]"
            onClick={() => resetToCatalog()}
          >
            Сбросить поиск
          </button>
        ) : null}
      </div>

      {playbackContext.type === 'album' ? (
        <AlbumModeBanner
          title={playbackContext.title}
          artist={playbackContext.artist}
          onExit={exitAlbumMode}
        />
      ) : null}

      <div className="home-deck-pane" hidden={stage === 'wave'}>
        {isLoading ? (
          <p className="py-20 text-center text-sm text-[var(--color-muted)]">
            Загрузка коллекции…
          </p>
        ) : error ? (
          <p className="py-20 text-center text-sm text-rose-600">{error}</p>
        ) : sortingTracks.length === 0 ? (
          <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-8 text-center">
            <p className="text-sm text-[var(--color-fg)]">
              Нет музыки из подключённых источников.
            </p>
            <p className="mt-1 text-sm text-[var(--color-muted)]">
              Демо-библиотека не попадает в ленту. Подключите свой источник.
            </p>
          </div>
        ) : (
          <SwipeDeck
            key={deckKey}
            tracks={sortingTracks}
            gestureConfig={gestureConfig}
            categoryResolveKey={categoryResolveKey}
            categoryCancelKey={categoryCancelKey}
            playerTrackId={playerTrackId}
            playerIsPlaying={playing}
            syncWithPlayer={sortingDeckFollowsPlayer({
              radioActive,
              contextType: playbackContext.type,
            })}
            playback={playback}
            audibleTrackId={audibleTrackId}
            startingTrackId={startingTrackId}
            nowPlaying={pendingPlaybackTrack ?? currentTrack}
            playbackContextType={playbackContext.type}
            onTogglePlay={playSortingTrack}
            onDeckNavigate={(track) => playListedTrack(track, sortingTracks, 'sorting', 'advance')}
            onCategorize={setPendingTrack}
          />
        )}
      </div>

      {stage === 'wave' && favoritesNote ? (
        <p className="px-1 text-center text-xs text-[var(--color-muted)] sm:text-left">{favoritesNote}</p>
      ) : null}

      {waveView === 'deck' ? (
        <div className="home-deck-pane" hidden={stage !== 'wave'}>
          <SwipeDeck
            tracks={waveTracks}
            gestureConfig={gestureConfig}
            categoryResolveKey={categoryResolveKey}
            categoryCancelKey={categoryCancelKey}
            playerTrackId={playerTrackId}
            playerIsPlaying={playing}
            syncWithPlayer
            playback={playback}
            audibleTrackId={audibleTrackId}
            startingTrackId={startingTrackId}
            onTogglePlay={playWaveTrack}
            onDeckNavigate={navigateWaveTrack}
            onCategorize={setPendingTrack}
          />
        </div>
      ) : stage === 'wave' ? (
        <WaveStartCard
          pending={wavePending}
          canStart={waveView === 'start'}
          showSourcesLink={waveView === 'needs-source'}
          message={
            waveView === 'needs-likes'
              ? 'Добавьте понравившиеся песни в «Избранное».'
              : waveView === 'needs-source'
                ? 'Подключите источник музыки, чтобы собрать волну.'
                : waveNotice
          }
          onStart={startWave}
        />
      ) : null}

      <CategoryPickerSheet
        open={pendingTrack !== null}
        trackTitle={pendingTrack?.title}
        categories={categories}
        onClose={() => {
          setPendingTrack(null)
          setCategoryCancelKey((value) => value + 1)
        }}
        onCreateCategory={createCategory}
        onSelect={(categoryId) => {
          if (!pendingTrack) {
            return
          }
          const track = pendingTrack
          const category = useCollectionStore
            .getState()
            .categories.find((item) => item.id === categoryId)
          setPendingTrack(null)
          setCategoryResolveKey((value) => value + 1)
          void commitCatalogChoice(track, categoryId, category)
        }}
      />
    </div>
  )
}

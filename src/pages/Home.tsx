import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlbumModeBanner } from '../components/AlbumModeBanner'
import { HomeCatalogsPanel } from '../components/catalog/HomeCatalogsPanel'
import CategoryPickerSheet from '../components/CategoryPickerSheet'
import SwipeDeck from '../components/SwipeDeck'
import WaveStartCard from '../components/WaveStartCard'
import { cancelCatalogPlaybackGate } from '../services/catalogPlayback'
import { useSwipeFeed } from '../hooks/useSwipeFeed'
import { getAudioPlayer } from '../services/audioPlayer'
import { commitCatalogChoice } from '../services/canonical/userOrganization.ts'
import { createCategoryConfirmed } from '../services/catalogs/createCategoryConfirmed.ts'
import { SAVE_FAILED_MESSAGE } from '../services/libraryPersistence/statusStore.ts'
import {
  beginSearchFlowCommand,
  isSearchSeedPlaybackEnabled,
  noteSearchFlowEvent,
  searchDeckUsesSeedPlayback,
} from '../services/continuation/index.ts'
import { getPlaybackIntent } from '../services/playbackIntent'
import { getPlaybackQueue } from '../services/playbackQueue'
import {
  resolveHomeDeckFocusId,
  resolveHomeDeckTracks,
} from '../services/recommendation/homeDeck.ts'
import { isRecommendationExhausted } from '../services/recommendation/sessionState.ts'
import {
  activateRecommendationSession,
  commitRecommendationSeed,
  getRecommendationSessionMode,
  pickRecommendationStart,
} from '../services/recommendation/sessionRuntime.ts'
import {
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

/** Вкладки главной. Не расширяет HomeStage (sorting/wave) для карточек. */
type HomeTab = 'sorting' | 'wave' | 'catalogs'

function initialHomeTab(): HomeTab {
  const context = usePlayerStore.getState().playbackContext
  if (context.type === 'radio') {
    return 'wave'
  }
  if (context.type === 'playlist') {
    return 'catalogs'
  }
  return 'sorting'
}

export default function Home() {
  const { tracks, isLoading, error, mode, searchQuery } = useSwipeFeed()
  const resetToCatalog = useSwipeDeckSessionStore((state) => state.resetToCatalog)
  const gestureConfig = useCollectionStore((state) => state.gestureConfig)
  const allCategories = useCollectionStore((state) => state.categories)
  const categories = useMemo(
    () => allCategories.filter((category) => category.id !== 'sys_swipes'),
    [allCategories],
  )

  const setQueue = usePlayerStore((state) => state.setQueue)
  const currentTime = usePlayerStore((state) => state.currentTime)
  const duration = usePlayerStore((state) => state.duration)
  const playerError = usePlayerStore((state) => state.error)
  const seek = usePlayerStore((state) => state.seek)
  const currentTrack = usePlayerStore((state) => state.currentTrack)
  const pendingPlaybackTrack = usePlayerStore((state) => state.pendingTrack)
  const playbackContext = usePlayerStore((state) => state.playbackContext)
  const queue = usePlayerStore((state) => state.queue)
  const queueIndex = usePlayerStore((state) => state.queueIndex)
  const playing = usePlayerStore((state) => state.playing)
  const playerLoading = usePlayerStore((state) => state.loading || state.buffering)
  const queueLocked = isQueueLockedContext(playbackContext)
  const radioActive = playbackContext.type === 'radio' && playbackContext.id === MY_WAVE_ID
  const audibleTrackId =
    pendingPlaybackTrack && pendingPlaybackTrack.id !== currentTrack?.id
      ? null
      : (currentTrack?.id ?? null)
  const startingTrackId =
    pendingPlaybackTrack?.id ??
    (playerLoading && !playing ? (currentTrack?.id ?? null) : null)

  const [homeTab, setHomeTab] = useState<HomeTab>(initialHomeTab)
  /** HomeStage только для sorting/wave-карточек; вкладка catalogs их не использует. */
  const stage: HomeStage = homeTab === 'catalogs' ? 'sorting' : homeTab
  const [wavePending, setWavePending] = useState(false)
  const [waveNotice, setWaveNotice] = useState<string | null>(null)
  const [pendingTrack, setPendingTrack] = useState<Track | null>(null)
  const [categorizeNotice, setCategorizeNotice] = useState<string | null>(null)
  const [categorizeBusy, setCategorizeBusy] = useState(false)
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

  const sessionMode = mode === 'search' ? 'search' : 'catalog'
  // module-flag exhausted перечитываем при смене playing/current (stop после miss).
  const sessionUiKey = `${playing ? 1 : 0}:${currentTrack?.id ?? ''}:${queueIndex}`
  const sortingDeck = useMemo(() => {
    void sessionUiKey
    return resolveHomeDeckTracks({
      stage: 'sorting',
      sessionMode,
      browseFeed: tracks,
      queue,
      queueIndex,
      currentTrack,
      pendingTrack: pendingPlaybackTrack,
      context: playbackContext,
      recommendationExhausted: isRecommendationExhausted(),
    })
  }, [
    sessionMode,
    tracks,
    queue,
    queueIndex,
    currentTrack,
    pendingPlaybackTrack,
    playbackContext,
    sessionUiKey,
  ])
  const waveDeck = useMemo(() => {
    void sessionUiKey
    return resolveHomeDeckTracks({
      stage: 'wave',
      sessionMode: 'catalog',
      browseFeed: tracks,
      queue,
      queueIndex,
      currentTrack,
      pendingTrack: pendingPlaybackTrack,
      context: playbackContext,
      recommendationExhausted: isRecommendationExhausted(),
    })
  }, [
    tracks,
    queue,
    queueIndex,
    currentTrack,
    pendingPlaybackTrack,
    playbackContext,
    sessionUiKey,
  ])
  const sortingTracks = sortingDeck.tracks
  const waveTracks = waveDeck.tracks
  const playerTrackId = resolveHomeDeckFocusId({
    pendingTrack: pendingPlaybackTrack,
    currentTrack,
    queue,
    queueIndex,
    deckSource: stage === 'wave' ? waveDeck.source : sortingDeck.source,
  })

  useEffect(() => {
    // Лента карточек ≠ рекомендательная очередь (единый Recommendation Engine).
    const live = getPlaybackQueue().getSnapshot()
    const liveLocked = isQueueLockedContext(live.context)
    if (
      !shouldReplaceHomeQueueWithSwipeFeed({
        queueLocked: queueLocked || liveLocked,
        feedLength: tracks.length,
        queueLength: Math.max(live.items.length, usePlayerStore.getState().queue.length),
        contextType: live.context.type,
        allowFeedAsQueue: false,
      })
    ) {
      return
    }
    setQueue(tracks.filter((track) => !isDemoSourceId(track.sourceId)), 0, { type: 'swipe' })
  }, [tracks, setQueue, queueLocked, mode])

  // Уход со страницы: отменить фоновую подготовку каталога, не останавливая плеер.
  useEffect(() => {
    return () => {
      cancelCatalogPlaybackGate()
    }
  }, [])

  // После reload: восстановить recommendation mode из persisted PlaybackContext.
  useEffect(() => {
    const active = getRecommendationSessionMode()
    if (playbackContext.type === 'search-seed' && active !== 'search') {
      activateRecommendationSession('search')
      return
    }
    if (
      playbackContext.type === 'swipe' &&
      sessionMode === 'catalog' &&
      active !== 'swipe'
    ) {
      activateRecommendationSession('swipe')
      return
    }
    if (radioActive && active !== 'wave') {
      activateRecommendationSession('wave')
    }
  }, [playbackContext, radioActive, sessionMode])

  // Холодный старт «Свайпы»: одна рекомендация в очередь без autoplay.
  useEffect(() => {
    if (mode === 'search') {
      return
    }
    let cancelled = false
    void (async () => {
      const live = getPlaybackQueue().getSnapshot()
      if (live.items.length > 0 || isQueueLockedContext(live.context)) {
        return
      }
      const picked = await pickRecommendationStart({ mode: 'swipe' })
      if (cancelled || !picked.ok) {
        return
      }
      const again = getPlaybackQueue().getSnapshot()
      if (again.items.length > 0 || isQueueLockedContext(again.context)) {
        return
      }
      commitRecommendationSeed({ mode: 'swipe', track: picked.track })
    })()
    return () => {
      cancelled = true
    }
  }, [mode, tracks])

  const playListedTrack = useCallback(
    (track: Track, _list: readonly Track[], nextStage: HomeStage, intent: 'toggle' | 'advance' = 'toggle') => {
      // Жест вперёд = единый AudioPlayer.next (search / swipe / wave recommendation).
      if (intent === 'advance') {
        // exhausted только на конце; после Previous хвост истории снова доступен.
        const queue = getPlaybackQueue()
        if (isRecommendationExhausted() && !queue.peekNext()) {
          noteSearchFlowEvent({
            source: 'Home.playListedTrack.advance',
            trackId: track.id,
            detail: 'exhausted→ignore',
          })
          return
        }
        beginSearchFlowCommand('Home.playListedTrack.advance')
        noteSearchFlowEvent({
          source: 'Home.playListedTrack.advance',
          trackId: track.id,
          detail: 'recommendation→AudioPlayer.next',
        })
        void getAudioPlayer().next()
        return
      }

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
                searchHits: session.tracks ?? [track],
              })
              return
            }
            // Каталог: одна стартовая композиция + recommendation session (не dump ленты).
            commitRecommendationSeed({ mode: 'swipe', track })
            await getAudioPlayer().playTrack(track)
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

  const navigateDeckPlayback = useCallback(
    (track: Track, direction: 'next' | 'previous', stage: HomeStage) => {
      if (direction === 'previous') {
        beginSearchFlowCommand('Home.navigateDeck.previous')
        noteSearchFlowEvent({
          source: 'Home.navigateDeck',
          trackId: track.id,
          detail: '→AudioPlayer.previous',
        })
        void getAudioPlayer().previous()
        return
      }
      playListedTrack(track, stage === 'wave' ? waveTracks : sortingTracks, stage, 'advance')
    },
    [playListedTrack, sortingTracks, waveTracks],
  )

  const navigateWaveTrack = useCallback(
    (track: Track, direction: 'next' | 'previous' = 'next') => {
      navigateDeckPlayback(track, direction, radioActive ? 'wave' : 'sorting')
    },
    [navigateDeckPlayback, radioActive],
  )

  const exitAlbumMode = useCallback(() => {
    const playerState = usePlayerStore.getState()
    getPlaybackIntent().exitAlbumMode({
      swipeTracks: sortingTracks,
      currentTrack: playerState.pendingTrack ?? playerState.currentTrack,
    })
  }, [sortingTracks])

  // Без id трека в key: иначе каждый Next размонтирует колоду.
  const deckKey =
    mode === 'search'
      ? `search:${searchQuery ?? ''}:${sortingDeck.source}`
      : `catalog:${sortingDeck.source}`

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
          className="home-mode-tabs"
          role="tablist"
          aria-label="Режим главной"
        >
          <button
            type="button"
            role="tab"
            aria-selected={homeTab === 'sorting'}
            className={[
              'home-mode-tab',
              homeTab === 'sorting' ? 'home-mode-tab-active' : 'home-mode-tab-idle',
            ].join(' ')}
            onClick={() => {
              // Только UI: без смены очереди, stop и без запуска рекомендаций.
              setHomeTab('sorting')
            }}
          >
            Свайпы
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={homeTab === 'wave'}
            className={[
              'home-mode-tab',
              homeTab === 'wave' ? 'home-mode-tab-active' : 'home-mode-tab-idle',
            ].join(' ')}
            onClick={() => {
              setHomeTab('wave')
            }}
          >
            Моя волна
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={homeTab === 'catalogs'}
            className={[
              'home-mode-tab',
              homeTab === 'catalogs' ? 'home-mode-tab-active' : 'home-mode-tab-idle',
            ].join(' ')}
            onClick={() => {
              setHomeTab('catalogs')
            }}
          >
            Каталоги
          </button>
        </div>
        <p className="text-center text-sm text-[var(--color-muted)] sm:text-left">
          {homeTab === 'catalogs'
            ? 'Выберите каталог — доступные композиции играют по кругу. «Открыть» ведёт к редактированию.'
            : homeTab === 'wave'
              ? waveView === 'deck'
                ? 'Карточка показывает очередь волны. Свайпы лайкают её, открывают каталог и переключают треки.'
                : 'Play на карточке собирает волну из избранного.'
              : mode === 'search' && searchQuery
                ? `Результаты: «${searchQuery}»`
                : 'Свайп оценивает трек. Play на карточке включает именно его.'}
        </p>
        {homeTab === 'sorting' &&
        playerTrackId &&
        playbackContext.type !== 'swipe' &&
        playbackContext.type !== 'none' &&
        playbackContext.type !== 'search-seed' ? (
          <p className="text-center text-xs text-[var(--color-muted)] sm:text-left">
            {radioActive
              ? 'В плеере всё ещё играет «Моя волна». Play на карточке переключит очередь на свайпы.'
              : playbackContext.type === 'playlist'
                ? 'В плеере играет каталог. Play на карточке переключит очередь на свайпы.'
                : 'В плеере другая композиция. Play на карточке включит именно её.'}
          </p>
        ) : null}
        {homeTab === 'sorting' && mode === 'search' ? (
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

      <div className="home-deck-pane" hidden={homeTab !== 'sorting'}>
        {isLoading ? (
          <p className="py-20 text-center text-sm text-[var(--color-muted)]">
            Загрузка коллекции…
          </p>
        ) : error ? (
          <p className="py-20 text-center text-sm text-rose-600">{error}</p>
        ) : sortingDeck.emptyReason === 'playback-empty' ? (
          <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-8 text-center">
            <p className="text-sm text-[var(--color-fg)]">
              Нет доступных рекомендаций для продолжения.
            </p>
            <p className="mt-1 text-sm text-[var(--color-muted)]">
              Выберите другой трек в поиске или подключите источник.
            </p>
          </div>
        ) : sortingDeck.emptyReason === 'playback-exhausted' ? (
          <div className="space-y-3">
            <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-center sm:text-left">
              <p className="text-sm text-[var(--color-fg)]">Рекомендации закончились.</p>
              <p className="mt-1 text-xs text-[var(--color-muted)]">
                Next не подставляет результаты поиска. Выберите другой трек или сбросьте поиск.
              </p>
            </div>
            <SwipeDeck
              key={`${deckKey}:exhausted`}
              tracks={sortingTracks}
              gestureConfig={gestureConfig}
              categoryResolveKey={categoryResolveKey}
              categoryCancelKey={categoryCancelKey}
              playerTrackId={playerTrackId}
              playerIsPlaying={false}
              syncWithPlayer={sortingDeck.syncWithPlayer}
              advanceAtEnd={false}
              playback={playback}
              audibleTrackId={null}
              startingTrackId={null}
              nowPlaying={currentTrack}
              playbackContextType={playbackContext.type}
              onTogglePlay={playSortingTrack}
              onDeckNavigate={() => {
                /* exhausted: Next/жест вперёд игнорируются */
              }}
              onCategorize={setPendingTrack}
            />
          </div>
        ) : sortingTracks.length === 0 ? (
          <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-8 text-center">
            <p className="text-sm text-[var(--color-fg)]">
              {mode === 'search'
                ? 'Ничего не найдено.'
                : 'Нет музыки из подключённых источников.'}
            </p>
            <p className="mt-1 text-sm text-[var(--color-muted)]">
              {mode === 'search'
                ? 'Измените запрос или сбросьте поиск.'
                : 'Демо-библиотека не попадает в ленту. Подключите свой источник.'}
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
            syncWithPlayer={sortingDeck.syncWithPlayer}
            advanceAtEnd={sortingDeck.advanceAtEnd}
            playback={playback}
            audibleTrackId={audibleTrackId}
            startingTrackId={startingTrackId}
            nowPlaying={pendingPlaybackTrack ?? currentTrack}
            playbackContextType={playbackContext.type}
            onTogglePlay={playSortingTrack}
            onDeckNavigate={(track, direction) =>
              navigateDeckPlayback(track, direction, 'sorting')
            }
            onCategorize={setPendingTrack}
          />
        )}
      </div>

      {homeTab === 'wave' && favoritesNote ? (
        <p className="px-1 text-center text-xs text-[var(--color-muted)] sm:text-left">{favoritesNote}</p>
      ) : null}

      {waveView === 'deck' ? (
        <div className="home-deck-pane" hidden={homeTab !== 'wave'}>
          {waveDeck.emptyReason === 'playback-empty' ? (
            <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-8 text-center">
              <p className="text-sm text-[var(--color-fg)]">
                Волна остановилась: нет следующей рекомендации.
              </p>
            </div>
          ) : waveDeck.emptyReason === 'playback-exhausted' ? (
            <div className="space-y-3">
              <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-center sm:text-left">
                <p className="text-sm text-[var(--color-fg)]">Рекомендации волны закончились.</p>
              </div>
              <SwipeDeck
                tracks={waveTracks}
                gestureConfig={gestureConfig}
                categoryResolveKey={categoryResolveKey}
                categoryCancelKey={categoryCancelKey}
                playerTrackId={playerTrackId}
                playerIsPlaying={false}
                syncWithPlayer={waveDeck.syncWithPlayer}
                advanceAtEnd={false}
                playback={playback}
                audibleTrackId={null}
                startingTrackId={null}
                nowPlaying={currentTrack}
                playbackContextType={playbackContext.type}
                onTogglePlay={playWaveTrack}
                onDeckNavigate={() => {
                  /* exhausted wave */
                }}
                onCategorize={setPendingTrack}
              />
            </div>
          ) : (
            <SwipeDeck
              tracks={waveTracks}
              gestureConfig={gestureConfig}
              categoryResolveKey={categoryResolveKey}
              categoryCancelKey={categoryCancelKey}
              playerTrackId={playerTrackId}
              playerIsPlaying={playing}
              syncWithPlayer={waveDeck.syncWithPlayer}
              advanceAtEnd={waveDeck.advanceAtEnd}
              playback={playback}
              audibleTrackId={audibleTrackId}
              startingTrackId={startingTrackId}
              nowPlaying={pendingPlaybackTrack ?? currentTrack}
              playbackContextType={playbackContext.type}
              onTogglePlay={playWaveTrack}
              onDeckNavigate={navigateWaveTrack}
              onCategorize={setPendingTrack}
            />
          )}
        </div>
      ) : homeTab === 'wave' ? (
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

      <div hidden={homeTab !== 'catalogs'}>
        <HomeCatalogsPanel />
      </div>

      {categorizeNotice ? (
        <p
          className="fixed bottom-24 left-1/2 z-40 max-w-sm -translate-x-1/2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-center text-sm text-[var(--color-fg)] shadow-lg"
          role="status"
        >
          {categorizeNotice}
        </p>
      ) : null}

      <CategoryPickerSheet
        open={pendingTrack !== null}
        trackTitle={pendingTrack?.title}
        categories={categories}
        onClose={() => {
          if (categorizeBusy) {
            return
          }
          setPendingTrack(null)
          setCategorizeNotice(null)
          setCategoryCancelKey((value) => value + 1)
        }}
        onCreateCategory={createCategoryConfirmed}
        onSelect={(categoryId) => {
          if (!pendingTrack || categorizeBusy) {
            return
          }
          const track = pendingTrack
          const category = useCollectionStore
            .getState()
            .categories.find((item) => item.id === categoryId)
          setCategorizeBusy(true)
          void commitCatalogChoice(track, categoryId, category).then((result) => {
            setCategorizeBusy(false)
            if (result.status === 'failed') {
              setCategorizeNotice(SAVE_FAILED_MESSAGE)
              // sheet остаётся открытым (pendingTrack) — можно повторить.
              return
            }
            if (result.status === 'partial') {
              setCategorizeNotice(
                'Сохранено в каталог, но не удалось убрать из «Свайпов». Можно повторить позже.',
              )
              setPendingTrack(null)
              setCategoryResolveKey((value) => value + 1)
              return
            }
            setCategorizeNotice(null)
            setPendingTrack(null)
            setCategoryResolveKey((value) => value + 1)
          })
        }}
      />
    </div>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useFullscreenPlayer } from '../../hooks/useFullscreenPlayer'
import { resolvePlayerSessionLabel } from '../../navigation/fullscreenPlayer'
import {
  canFullscreenLike,
  resolveCatalogCommitTrack,
  resolveFullscreenActionTrack,
  shouldDismissCatalogOnTrackChange,
} from '../../navigation/fullscreenPlayerActions'
import { sourceTrackKeyOf } from '../../services/canonical/mapCanonical'
import { canonicalItemForTrack, isSourceCopyLiked } from '../../services/canonical/selectors'
import { commitCatalogChoice } from '../../services/canonical/userOrganization'
import { createCategoryConfirmed } from '../../services/catalogs/createCategoryConfirmed'
import { beginSearchFlowCommand } from '../../services/continuation/searchFlowDiag'
import { SAVE_FAILED_MESSAGE } from '../../services/libraryPersistence/statusStore'
import { openManualSourceAlternatives } from '../../services/runtimeFallback/fallbackUxRuntime'
import { isSessionSwitchIntegrationEnabled } from '../../services/sessionSwitch/featureFlag'
import { getSessionSwitchAppRuntime } from '../../services/sessionSwitch/integration/sessionSwitchAppRuntime'
import { classifySwipeTrack } from '../../services/swipeClassification'
import { useCanonicalLibraryStore } from '../../store/canonicalLibraryStore'
import { useCollectionStore } from '../../store/collectionStore'
import { usePlaybackFallbackUxStore } from '../../store/playbackFallbackUxStore'
import { useGlobalPlayerStore } from '../../store/playerStore'
import type { Track } from '../../types/track'
import { formatPlaybackTime } from '../../utils/formatTime'
import { getSourceDisplayName } from '../../utils/sourceDisplay'
import CategoryPickerSheet from '../CategoryPickerSheet'
import {
  CloseIcon,
  HeartIcon,
  MoreIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PreviousIcon,
  QueueListIcon,
  RepeatIcon,
  ShuffleIcon,
} from '../icons'
import PlayerProgressBar from './PlayerProgressBar'

/**
 * Overlay поверх текущего раздела. Состояние только из playerStore / SessionSwitch.
 * Не создаёт AudioPlayer и не меняет сессию при open/close.
 */
export default function FullscreenPlayer() {
  const { isOpen, close } = useFullscreenPlayer()
  if (!isOpen) {
    return null
  }
  return <FullscreenPlayerPanel onClose={close} />
}

function FullscreenPlayerPanel({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  const currentTrack = useGlobalPlayerStore((s) => s.currentTrack)
  const pendingTrack = useGlobalPlayerStore((s) => s.pendingTrack)
  const activeCandidate = useGlobalPlayerStore((s) => s.activeCandidate)
  const playing = useGlobalPlayerStore((s) => s.playing)
  const buffering = useGlobalPlayerStore((s) => s.buffering)
  const loading = useGlobalPlayerStore((s) => s.loading)
  const currentTime = useGlobalPlayerStore((s) => s.currentTime)
  const duration = useGlobalPlayerStore((s) => s.duration)
  const repeatMode = useGlobalPlayerStore((s) => s.repeatMode)
  const shuffleMode = useGlobalPlayerStore((s) => s.shuffleMode)
  const error = useGlobalPlayerStore((s) => s.error)
  const queueLength = useGlobalPlayerStore((s) => s.queue.length)
  const playbackContext = useGlobalPlayerStore((s) => s.playbackContext)
  const ownsPlayerError = usePlaybackFallbackUxStore((s) => s.model.ownsPlayerError)

  const pause = useGlobalPlayerStore((s) => s.pause)
  const resume = useGlobalPlayerStore((s) => s.resume)
  const next = useGlobalPlayerStore((s) => s.next)
  const previous = useGlobalPlayerStore((s) => s.previous)
  const seek = useGlobalPlayerStore((s) => s.seek)
  const cycleRepeatMode = useGlobalPlayerStore((s) => s.cycleRepeatMode)
  const toggleShuffle = useGlobalPlayerStore((s) => s.toggleShuffle)

  const itemsById = useCanonicalLibraryStore((s) => s.itemsById)
  const sourceKeyToCanonicalId = useCanonicalLibraryStore((s) => s.sourceKeyToCanonicalId)
  const canonicalLookup = useMemo(
    () => ({ itemsById, sourceKeyToCanonicalId }),
    [itemsById, sourceKeyToCanonicalId],
  )
  const allCategories = useCollectionStore((s) => s.categories)
  const categories = useMemo(
    () => allCategories.filter((category) => category.id !== 'sys_swipes'),
    [allCategories],
  )

  const [menuOpen, setMenuOpen] = useState(false)
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [catalogTrack, setCatalogTrack] = useState<Track | null>(null)
  const [catalogBusy, setCatalogBusy] = useState(false)
  const [likeBusy, setLikeBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const displayTrack = pendingTrack ?? currentTrack
  const switching = Boolean(pendingTrack)
  const canControl = Boolean(currentTrack) && !switching
  const busy = switching || buffering || loading
  const launching = busy && !playing
  const actionTrack = resolveFullscreenActionTrack({ currentTrack, pendingTrack })

  const liked = actionTrack
    ? isSourceCopyLiked(canonicalLookup, sourceTrackKeyOf(actionTrack))
    : false
  const likeEnabled = canFullscreenLike({
    actionTrack,
    liked,
    likeBusy,
  })
  const alternativeCount = displayTrack
    ? (canonicalItemForTrack(canonicalLookup, displayTrack)?.copies.length ?? 0)
    : 0
  const catalogStale = shouldDismissCatalogOnTrackChange({
    catalogOpen,
    pinnedTrackId: catalogTrack?.id,
    currentTrackId: currentTrack?.id,
  })
  const catalogSheetOpen = catalogOpen && !catalogStale

  const activeSessionId = isSessionSwitchIntegrationEnabled()
    ? (getSessionSwitchAppRuntime()?.store.getActiveSessionId() ?? null)
    : null
  const sessionLabel = resolvePlayerSessionLabel({
    context: playbackContext,
    activeSessionId,
  })

  const sourceLabel = displayTrack ? getSourceDisplayName(displayTrack.sourceId) : null
  const coverStyle = displayTrack?.coverUrl
    ? { backgroundImage: `url(${displayTrack.coverUrl})` }
    : { backgroundColor: displayTrack?.coverColor ?? 'var(--color-accent)' }

  const clearCatalogSheet = () => {
    setCatalogOpen(false)
    setCatalogTrack(null)
    setCatalogBusy(false)
  }

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    closeButtonRef.current?.focus()
    return () => {
      const mini = document.querySelector(
        '[data-testid="mini-player-open-fullscreen"]',
      ) as HTMLElement | null
      if (mini && typeof mini.focus === 'function') {
        mini.focus()
        return
      }
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus()
      }
    }
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }
      if (catalogSheetOpen) {
        clearCatalogSheet()
        return
      }
      if (menuOpen) {
        setMenuOpen(false)
        return
      }
      onClose()
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose, catalogSheetOpen, menuOpen])

  const togglePlay = () => {
    if (playing) {
      pause()
      return
    }
    void resume()
  }

  const onLike = () => {
    if (!likeEnabled || !actionTrack) {
      return
    }
    setLikeBusy(true)
    const result = classifySwipeTrack(actionTrack, 'like')
    if (result.kind === 'applied' && result.saved) {
      void result.saved.finally(() => setLikeBusy(false))
      return
    }
    setLikeBusy(false)
  }

  const openCatalog = () => {
    if (!actionTrack) {
      return
    }
    setCatalogTrack(actionTrack)
    setCatalogOpen(true)
    setNotice(null)
  }

  const openQueue = () => {
    navigate('/queue', { replace: true })
  }

  return (
    <div
      className="fullscreen-player"
      role="dialog"
      aria-modal="true"
      aria-label="Полноэкранный плеер"
      data-testid="fullscreen-player"
    >
      <div className="fullscreen-player-frame">
        <header className="fullscreen-player-top">
          <button
            ref={closeButtonRef}
            type="button"
            className="deck-key deck-key-utility min-h-11 min-w-11"
            aria-label="Свернуть плеер"
            data-testid="fullscreen-player-close"
            onClick={onClose}
          >
            <CloseIcon className="h-5 w-5" />
          </button>
          <div className="min-w-0 text-center">
            <p
              className="truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-accent)]"
              data-testid="fullscreen-player-session"
            >
              {sessionLabel}
            </p>
            <p className="truncate text-xs text-[var(--color-muted)]">Сейчас играет</p>
          </div>
          <div className="relative">
            <button
              type="button"
              className="deck-key deck-key-utility min-h-11 min-w-11"
              aria-label="Меню плеера"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <MoreIcon className="h-5 w-5" />
            </button>
            {menuOpen ? (
              <div className="deck-menu absolute right-0 top-12 z-40 min-w-[12rem] overflow-hidden py-1">
                <button
                  type="button"
                  className="block min-h-11 w-full px-3 py-2 text-left text-sm text-[var(--color-fg)] hover:bg-[var(--color-surface-hover)]"
                  onClick={() => {
                    setMenuOpen(false)
                    openQueue()
                  }}
                >
                  Очередь ({queueLength})
                </button>
                {alternativeCount >= 2 && actionTrack ? (
                  <button
                    type="button"
                    className="block min-h-11 w-full px-3 py-2 text-left text-sm text-[var(--color-fg)] hover:bg-[var(--color-surface-hover)]"
                    onClick={() => {
                      setMenuOpen(false)
                      void openManualSourceAlternatives(actionTrack)
                    }}
                  >
                    Источники композиции
                  </button>
                ) : null}
                <button
                  type="button"
                  className="block min-h-11 w-full px-3 py-2 text-left text-sm text-[var(--color-fg)] hover:bg-[var(--color-surface-hover)]"
                  onClick={() => {
                    toggleShuffle()
                    setMenuOpen(false)
                  }}
                >
                  Shuffle: {shuffleMode}
                </button>
                <button
                  type="button"
                  className="block min-h-11 w-full px-3 py-2 text-left text-sm text-[var(--color-fg)] hover:bg-[var(--color-surface-hover)]"
                  onClick={() => {
                    cycleRepeatMode()
                    setMenuOpen(false)
                  }}
                >
                  Repeat: {repeatMode}
                </button>
              </div>
            ) : null}
          </div>
        </header>

        <div className="fullscreen-player-art-wrap">
          <div
            className="fullscreen-player-art rounded-[1.5rem] bg-cover bg-center"
            style={coverStyle}
            aria-hidden
          />
        </div>

        <div className="fullscreen-player-meta">
          <h2 className="truncate font-display text-2xl font-semibold tracking-tight text-[var(--color-fg)] sm:text-3xl">
            {displayTrack?.title ?? 'Ничего не играет'}
          </h2>
          <p className="truncate text-base text-[var(--color-muted)]">
            {displayTrack?.artist ?? 'Выберите композицию в любом разделе'}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--color-muted)]">
            {sourceLabel ? (
              <span className="rounded-full border border-[var(--color-border)] px-2 py-1 uppercase tracking-wide text-[var(--color-accent)]">
                {sourceLabel}
              </span>
            ) : null}
            {switching ? (
              <span className="text-[var(--color-accent)]">Переключение…</span>
            ) : buffering || loading ? (
              <span className="text-[var(--color-accent)]">Загрузка…</span>
            ) : activeCandidate?.type ? (
              <span>{activeCandidate.type}</span>
            ) : null}
          </div>
        </div>

        <div className="fullscreen-player-progress">
          <PlayerProgressBar
            currentTime={currentTime}
            duration={duration}
            disabled={!canControl || duration <= 0}
            onSeek={seek}
          />
          <div className="mt-1 flex justify-between text-xs tabular-nums text-[var(--color-muted)]">
            <span>{formatPlaybackTime(currentTime)}</span>
            <span>{formatPlaybackTime(duration)}</span>
          </div>
        </div>

        <div className="fullscreen-player-transport" data-testid="fullscreen-player-transport">
          <button
            type="button"
            className="deck-key deck-key-utility min-h-11 min-w-11"
            aria-label="Shuffle"
            aria-pressed={shuffleMode === 'ON'}
            disabled={!canControl}
            onClick={toggleShuffle}
          >
            <ShuffleIcon className="h-5 w-5" />
          </button>
          <button
            type="button"
            className="deck-key deck-key-side min-h-12 min-w-12"
            aria-label="Предыдущий"
            disabled={!canControl}
            onClick={() => {
              clearCatalogSheet()
              void previous()
            }}
          >
            <PreviousIcon className="h-6 w-6" />
          </button>
          <button
            type="button"
            className="deck-key deck-key-primary min-h-14 min-w-14"
            aria-label={playing ? 'Пауза' : launching ? 'Запуск' : 'Воспроизведение'}
            aria-pressed={playing}
            aria-busy={launching || undefined}
            disabled={!canControl}
            onClick={togglePlay}
          >
            {playing ? (
              <PauseIcon />
            ) : launching ? (
              <span className="h-6 w-6 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" />
            ) : (
              <PlayIcon className="translate-x-0.5" />
            )}
          </button>
          <button
            type="button"
            className="deck-key deck-key-side min-h-12 min-w-12"
            aria-label="Следующий"
            disabled={!canControl}
            onClick={() => {
              clearCatalogSheet()
              beginSearchFlowCommand('FullscreenPlayer.Next')
              void next()
            }}
          >
            <NextIcon className="h-6 w-6" />
          </button>
          <button
            type="button"
            className="deck-key deck-key-utility min-h-11 min-w-11"
            aria-label={`Repeat: ${repeatMode}`}
            aria-pressed={repeatMode !== 'OFF'}
            disabled={!canControl}
            onClick={cycleRepeatMode}
          >
            <span className="relative">
              <RepeatIcon className="h-5 w-5" />
              {repeatMode === 'ONE' ? (
                <span className="absolute -right-1.5 -top-1.5 text-[9px] font-semibold leading-none">
                  1
                </span>
              ) : null}
            </span>
          </button>
        </div>

        <div className="fullscreen-player-actions">
          <button
            type="button"
            className="deck-key deck-key-utility min-h-11 min-w-11"
            aria-label={liked ? 'В избранном' : 'Лайк'}
            aria-pressed={liked}
            data-testid="fullscreen-player-like"
            disabled={!likeEnabled}
            onClick={onLike}
          >
            <HeartIcon className="h-5 w-5" filled={liked} />
          </button>
          <button
            type="button"
            className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm font-medium text-[var(--color-fg)] disabled:opacity-40"
            data-testid="fullscreen-player-catalog"
            disabled={!actionTrack || catalogBusy}
            onClick={openCatalog}
          >
            В каталог
          </button>
          <button
            type="button"
            className="deck-key deck-key-utility min-h-11 min-w-11"
            aria-label={`Очередь, ${queueLength}`}
            onClick={openQueue}
          >
            <QueueListIcon className="h-5 w-5" />
          </button>
        </div>

        {error && !ownsPlayerError ? (
          <p className="px-1 text-center text-sm text-rose-500" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="px-1 text-center text-sm text-[var(--color-fg)]" role="status">
            {notice}
          </p>
        ) : null}
      </div>

      <CategoryPickerSheet
        open={catalogSheetOpen}
        trackTitle={catalogTrack?.title}
        categories={categories}
        onClose={() => {
          if (catalogBusy) {
            return
          }
          clearCatalogSheet()
        }}
        onCreateCategory={createCategoryConfirmed}
        onSelect={(categoryId) => {
          const track = resolveCatalogCommitTrack({
            pinnedTrack: catalogTrack,
            currentTrack,
          })
          if (!track || catalogBusy) {
            clearCatalogSheet()
            return
          }
          const category = useCollectionStore
            .getState()
            .categories.find((item) => item.id === categoryId)
          setCatalogBusy(true)
          void commitCatalogChoice(track, categoryId, category).then((result) => {
            setCatalogBusy(false)
            if (result.status === 'failed') {
              setNotice(SAVE_FAILED_MESSAGE)
              return
            }
            if (result.status === 'partial') {
              setNotice(
                'Сохранено в каталог, но не удалось убрать из «Свайпов». Можно повторить позже.',
              )
              clearCatalogSheet()
              return
            }
            setNotice(null)
            clearCatalogSheet()
          })
        }}
      />
    </div>
  )
}

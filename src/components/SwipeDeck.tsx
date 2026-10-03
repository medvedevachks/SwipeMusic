import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import { useSpring } from '@react-spring/web'
import { useDrag } from '@use-gesture/react'
import {
  defaultGestureConfig,
  dragOverlayCaption,
  getDirectionFromMovement,
} from '../config/gestureConfig'
import {
  resolveSwipeAction,
  SWIPE_FLY_DISTANCE,
  SWIPE_THRESHOLD,
} from '../services/swipeEngine'
import { classifySwipeTrack } from '../services/swipeClassification'
import type { GestureConfig, SwipeDirection } from '../types/gesture'
import type { SwipeAction } from '../types/swipe'
import type { Track } from '../types/track'
import { getSourceDisplayName } from '../utils/sourceDisplay'
import SwipeCard from './SwipeCard'
import { SwipeDirectionHints } from './SwipeDirectionHints'

type PlaybackState = {
  currentTime: number
  duration: number
  canSeek: boolean
  onSeek: (timeSeconds: number) => void
  error?: string | null
}

type SwipeDeckProps = {
  tracks: Track[]
  gestureConfig?: GestureConfig
  categoryResolveKey?: number
  categoryCancelKey?: number
  /** Global Player → показать эту карточку, если трек есть в колоде. */
  playerTrackId?: string | null
  onCategorize: (track: Track) => void
  /**
   * После skip / previous / like колода сменила активный трек —
   * Global Player должен переключиться на него.
   */
  onDeckNavigate: (track: Track) => void
  playback?: PlaybackState | null
}

export type SwipeDeckHandle = {
  goNext: () => void
  goPrevious: () => void
}

const SWIPE_COMMIT_MS = 180

function flyTarget(direction: SwipeDirection) {
  switch (direction) {
    case 'right':
      return { x: SWIPE_FLY_DISTANCE, y: 40, rot: 22 }
    case 'left':
      return { x: -SWIPE_FLY_DISTANCE, y: 40, rot: -22 }
    case 'up':
      return { x: 0, y: -SWIPE_FLY_DISTANCE, rot: -8 }
    case 'down':
      return { x: 0, y: SWIPE_FLY_DISTANCE, rot: 8 }
  }
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1)
}

const SwipeDeck = forwardRef<SwipeDeckHandle, SwipeDeckProps>(
  function SwipeDeck(
    {
      tracks,
      gestureConfig = defaultGestureConfig,
      categoryResolveKey = 0,
      categoryCancelKey = 0,
      playerTrackId = null,
      onCategorize,
      onDeckNavigate,
      playback = null,
    },
    ref,
  ) {
    const [index, setIndex] = useState(0)
    const [dragDirection, setDragDirection] = useState<SwipeDirection | null>(
      null,
    )
    const [dragProgress, setDragProgress] = useState(0)
    const lockedRef = useRef(false)
    const awaitingCategoryRef = useRef(false)
    const prevResolveKeyRef = useRef(categoryResolveKey)
    const prevCancelKeyRef = useRef(categoryCancelKey)
    const indexRef = useRef(0)
    const prevPlayerTrackIdRef = useRef<string | null>(null)
    const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    /** Пропуск sync сразу после нашей навигации (player ещё догоняет). */
    const ignorePlayerSyncRef = useRef(false)

    const current = tracks[index]
    const next = tracks[index + 1]
    const playbackForCard =
      playback && current && playerTrackId === current.id ? playback : null
    const dragOverlayText =
      dragDirection != null
        ? dragOverlayCaption(dragDirection, gestureConfig)
        : null

    const clearDragVisual = useCallback(() => {
      setDragDirection(null)
      setDragProgress(0)
    }, [])

    useEffect(() => {
      indexRef.current = index
    }, [index])

    useEffect(() => {
      return () => {
        if (commitTimerRef.current) {
          clearTimeout(commitTimerRef.current)
        }
      }
    }, [])

    const [front, frontApi] = useSpring(() => ({
      x: 0,
      y: 0,
      rot: 0,
      scale: 1,
      opacity: 1,
    }))

    const [back, backApi] = useSpring(() => ({
      x: 0,
      y: 14,
      rot: 0,
      scale: 0.96,
      opacity: 1,
    }))

    const resetSprings = useCallback(() => {
      frontApi.set({ x: 0, y: 0, rot: 0, scale: 1, opacity: 1 })
      backApi.set({ x: 0, y: 14, rot: 0, scale: 0.96, opacity: 1 })
    }, [backApi, frontApi])

    const jumpToIndex = useCallback(
      (nextIndex: number, notifyPlayer: boolean) => {
        clearDragVisual()
        lockedRef.current = false
        awaitingCategoryRef.current = false
        resetSprings()
        indexRef.current = nextIndex
        setIndex(nextIndex)

        const track = tracks[nextIndex]
        if (notifyPlayer && track) {
          ignorePlayerSyncRef.current = true
          onDeckNavigate(track)
        }
      },
      [clearDragVisual, onDeckNavigate, resetSprings, tracks],
    )

    const goNext = useCallback(
      (notifyPlayer: boolean) => {
        const nextIndex = indexRef.current + 1
        if (nextIndex >= tracks.length) {
          lockedRef.current = false
          clearDragVisual()
          resetSprings()
          setIndex(tracks.length)
          indexRef.current = tracks.length
          return
        }
        jumpToIndex(nextIndex, notifyPlayer)
      },
      [clearDragVisual, jumpToIndex, resetSprings, tracks.length],
    )

    const goPrevious = useCallback(
      (notifyPlayer: boolean) => {
        if (indexRef.current <= 0) {
          lockedRef.current = false
          clearDragVisual()
          resetSprings()
          return
        }
        jumpToIndex(indexRef.current - 1, notifyPlayer)
      },
      [clearDragVisual, jumpToIndex, resetSprings],
    )

    useImperativeHandle(
      ref,
      () => ({
        goNext: () => goNext(true),
        goPrevious: () => goPrevious(true),
      }),
      [goNext, goPrevious],
    )

    /** Global Player → колода: текущий playing трек всегда на карточке (если есть в deck). */
    useEffect(() => {
      if (!playerTrackId || tracks.length === 0) {
        prevPlayerTrackIdRef.current = playerTrackId
        return
      }

      if (ignorePlayerSyncRef.current) {
        ignorePlayerSyncRef.current = false
        prevPlayerTrackIdRef.current = playerTrackId
        return
      }

      const playerIndex = tracks.findIndex((track) => track.id === playerTrackId)
      if (playerIndex < 0) {
        prevPlayerTrackIdRef.current = playerTrackId
        return
      }

      prevPlayerTrackIdRef.current = playerTrackId

      if (playerIndex === indexRef.current) {
        return
      }

      if (commitTimerRef.current) {
        clearTimeout(commitTimerRef.current)
        commitTimerRef.current = null
      }

      lockedRef.current = false
      awaitingCategoryRef.current = false
      clearDragVisual()
      resetSprings()
      indexRef.current = playerIndex
      setIndex(playerIndex)
    }, [playerTrackId, tracks, resetSprings, clearDragVisual])

    const restoreCurrent = useCallback(() => {
      awaitingCategoryRef.current = false
      lockedRef.current = false
      clearDragVisual()
      resetSprings()
      void frontApi.start({
        x: 0,
        y: 0,
        rot: 0,
        scale: 1,
        opacity: 1,
        config: { tension: 280, friction: 22 },
      })
    }, [clearDragVisual, frontApi, resetSprings])

    // После выбора каталога — та же песня / та же карточка.
    useEffect(() => {
      if (prevResolveKeyRef.current === categoryResolveKey) {
        return
      }
      prevResolveKeyRef.current = categoryResolveKey
      if (awaitingCategoryRef.current) {
        restoreCurrent()
      }
    }, [categoryResolveKey, restoreCurrent])

    useEffect(() => {
      if (prevCancelKeyRef.current === categoryCancelKey) {
        return
      }
      prevCancelKeyRef.current = categoryCancelKey
      if (awaitingCategoryRef.current) {
        restoreCurrent()
      }
    }, [categoryCancelKey, restoreCurrent])

    const finishAction = useCallback(
      (action: SwipeAction, track: Track) => {
        const result = classifySwipeTrack(track, action)

        if (result.kind === 'needsCategory') {
          awaitingCategoryRef.current = true
          onCategorize(track)
          // Карточка уже улетела — ждём picker; затем restoreCurrent (та же песня).
          return
        }

        if (action === 'previous') {
          goPrevious(true)
          return
        }

        // like / skip → следующая карточка + Global Player
        goNext(true)
      },
      [goNext, goPrevious, onCategorize],
    )

    const bind = useDrag(
      ({ active, movement: [mx, my], velocity: [vx, vy], last }) => {
        if (!current || lockedRef.current || awaitingCategoryRef.current) {
          return
        }

        const progress = clamp01(Math.hypot(mx, my) / SWIPE_THRESHOLD)
        const direction = getDirectionFromMovement(mx, my, 28)
        const decision = direction
          ? resolveSwipeAction({
              track: current,
              direction,
              gestureConfig,
              deckIndex: indexRef.current,
            })
          : null

        if (active) {
          setDragDirection(direction)
          setDragProgress(progress)
          // Horizontal: лёгкий tilt; vertical: почти без rotation.
          const horizontal = Math.abs(mx) >= Math.abs(my)
          frontApi.set({
            x: mx,
            y: my,
            rot: horizontal ? mx / 20 : my / 90,
            scale: 1.03,
            opacity: 1,
          })
          backApi.set({
            scale: 0.97 + Math.min(Math.hypot(mx, my) / 1800, 0.03),
            y: 14 - Math.min(Math.hypot(mx, my) / 40, 10),
            opacity: 1,
          })
          return
        }

        // Gesture ended
        const flick = Math.hypot(vx, vy) > 0.35
        const passed =
          Math.abs(mx) > SWIPE_THRESHOLD ||
          Math.abs(my) > SWIPE_THRESHOLD ||
          (flick && (Math.abs(mx) > 32 || Math.abs(my) > 32))

        if (last && decision && passed) {
          if (decision.action === 'previous' && !decision.canGoPrevious) {
            clearDragVisual()
            void frontApi.start({
              x: 0,
              y: 0,
              rot: 0,
              scale: 1,
              opacity: 1,
              config: { tension: 320, friction: 24 },
            })
            return
          }

          lockedRef.current = true
          const action = decision.action
          const track = decision.track
          const target = flyTarget(decision.direction)
          clearDragVisual()

          void frontApi.start({
            ...target,
            opacity: 0,
            scale: 1.04,
            config: { tension: 180, friction: 18, clamp: true },
          })

          if (action !== 'categorize' && action !== 'previous') {
            void backApi.start({
              y: 0,
              scale: 1,
              opacity: 1,
              config: { tension: 240, friction: 20 },
            })
          }

          if (commitTimerRef.current) {
            clearTimeout(commitTimerRef.current)
          }
          commitTimerRef.current = setTimeout(() => {
            commitTimerRef.current = null
            finishAction(action, track)
          }, SWIPE_COMMIT_MS)
          return
        }

        clearDragVisual()
        void frontApi.start({
          x: 0,
          y: 0,
          rot: 0,
          scale: 1,
          opacity: 1,
          config: { tension: 320, friction: 24 },
        })
        void backApi.start({
          y: 14,
          scale: 0.96,
          opacity: 1,
          config: { tension: 280, friction: 24 },
        })
      },
      {
        from: () => [front.x.get(), front.y.get()],
        filterTaps: true,
        preventScroll: true,
      },
    )

    if (tracks.length === 0) {
      return (
        <p className="py-16 text-center text-sm text-[var(--color-muted)]">
          Нет треков для сортировки
        </p>
      )
    }

    if (!current) {
      return (
        <div className="flex h-[460px] max-h-[52vh] flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface)]/60 px-6 text-center">
          <p className="font-display text-xl font-semibold text-[var(--color-fg)]">
            Коллекция разобрана
          </p>
          <p className="text-sm text-[var(--color-muted)]">
            Все доступные треки уже просмотрены
          </p>
          <button
            type="button"
            className="mt-2 rounded-xl bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white"
            onClick={() => {
              lockedRef.current = false
              awaitingCategoryRef.current = false
              clearDragVisual()
              resetSprings()
              indexRef.current = 0
              setIndex(0)
            }}
          >
            Начать сначала
          </button>
        </div>
      )
    }

    return (
      <div className="relative mx-auto mb-6 w-full max-w-sm px-[4.5rem] pb-8 pt-7">
        <SwipeDirectionHints
          gestureConfig={gestureConfig}
          activeDirection={dragDirection}
          progress={dragProgress}
        />

        <div className="relative z-[1] h-[420px] max-h-[48vh] touch-none overflow-hidden">
          {next && (
            <SwipeCard
              key={`back-${next.id}`}
              track={next}
              sourceLabel={getSourceDisplayName(next.sourceId)}
              x={back.x}
              y={back.y}
              rot={back.rot}
              scale={back.scale}
              opacity={back.opacity}
              zIndex={1}
            />
          )}

          <SwipeCard
            key={`front-${current.id}`}
            track={current}
            sourceLabel={getSourceDisplayName(current.sourceId)}
            x={front.x}
            y={front.y}
            rot={front.rot}
            scale={front.scale}
            opacity={front.opacity}
            bind={() => bind()}
            interactive
            dragOverlayText={dragOverlayText}
            dragDirection={dragDirection}
            dragProgress={dragProgress}
            zIndex={2}
            playback={playbackForCard}
          />
        </div>
      </div>
    )
  },
)

export default SwipeDeck

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useSpring } from '@react-spring/web'
import { useDrag } from '@use-gesture/react'
import {
  defaultGestureConfig,
  gestureActionLabels,
  getDirectionFromMovement,
} from '../config/gestureConfig'
import {
  resolveSwipeAction,
  SWIPE_FLY_DISTANCE,
  SWIPE_THRESHOLD,
} from '../services/swipeEngine'
import type { GestureConfig, SwipeDirection } from '../types/gesture'
import type { SwipeAction } from '../types/swipe'
import type { Track } from '../types/track'
import { getSourceDisplayName } from '../utils/sourceDisplay'
import SwipeCard from './SwipeCard'

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
  onCategorize: (track: Track) => void
  onLike: (track: Track) => void
  onSkip?: (track: Track) => void
  onPrevious?: (track: Track) => void
  onCurrentTrackChange?: (track: Track | null) => void
  playback?: PlaybackState | null
}

export type SwipeDeckHandle = {
  goNext: () => void
  goPrevious: () => void
}

function flyTarget(direction: SwipeDirection) {
  switch (direction) {
    case 'right':
      return { x: SWIPE_FLY_DISTANCE, y: 36, rot: 26 }
    case 'left':
      return { x: -SWIPE_FLY_DISTANCE, y: 36, rot: -26 }
    case 'up':
      return { x: 0, y: -SWIPE_FLY_DISTANCE, rot: -6 }
    case 'down':
      return { x: 0, y: SWIPE_FLY_DISTANCE, rot: 6 }
  }
}

function directionHints(config: GestureConfig) {
  return [
    { dir: '←', action: config.left },
    { dir: '↑', action: config.up },
    { dir: '↓', action: config.down },
    { dir: '→', action: config.right },
  ] as const
}

const SwipeDeck = forwardRef<SwipeDeckHandle, SwipeDeckProps>(
  function SwipeDeck(
    {
      tracks,
      gestureConfig = defaultGestureConfig,
      categoryResolveKey = 0,
      categoryCancelKey = 0,
      onCategorize,
      onLike,
      onSkip,
      onPrevious,
      onCurrentTrackChange,
      playback = null,
    },
    ref,
  ) {
    const [index, setIndex] = useState(0)
    const [hintAction, setHintAction] = useState<SwipeAction | null>(null)
    const lockedRef = useRef(false)
    const awaitingCategoryRef = useRef(false)
    const pendingTrackRef = useRef<Track | null>(null)
    const prevResolveKeyRef = useRef(categoryResolveKey)
    const prevCancelKeyRef = useRef(categoryCancelKey)
    const indexRef = useRef(0)

    const current = tracks[index]
    const next = tracks[index + 1]
    const hints = useMemo(() => directionHints(gestureConfig), [gestureConfig])

    useEffect(() => {
      indexRef.current = index
    }, [index])

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

    /** Жёсткий сброс — без «from: opacity 0», иначе после свайпа карточка остаётся невидимой. */
    const resetSprings = useCallback(() => {
      frontApi.set({ x: 0, y: 0, rot: 0, scale: 1, opacity: 1 })
      backApi.set({ x: 0, y: 14, rot: 0, scale: 0.96, opacity: 1 })
    }, [backApi, frontApi])

    const goNext = useCallback(() => {
      setHintAction(null)
      lockedRef.current = false
      awaitingCategoryRef.current = false
      pendingTrackRef.current = null
      resetSprings()
      setIndex((value) => value + 1)
    }, [resetSprings])

    const goPrevious = useCallback(() => {
      setHintAction(null)
      lockedRef.current = false
      if (indexRef.current <= 0) {
        resetSprings()
        return
      }
      resetSprings()
      setIndex((value) => Math.max(0, value - 1))
    }, [resetSprings])

    useImperativeHandle(ref, () => ({ goNext, goPrevious }), [goNext, goPrevious])

    useEffect(() => {
      onCurrentTrackChange?.(current ?? null)
    }, [current, onCurrentTrackChange])

    const restoreCurrent = useCallback(() => {
      awaitingCategoryRef.current = false
      pendingTrackRef.current = null
      lockedRef.current = false
      setHintAction(null)
      resetSprings()
      void frontApi.start({
        x: 0,
        y: 0,
        rot: 0,
        scale: 1,
        opacity: 1,
        from: {
          x: SWIPE_FLY_DISTANCE * 0.2,
          y: 12,
          rot: 8,
          scale: 0.98,
          opacity: 1,
        },
        config: { tension: 280, friction: 22 },
      })
    }, [frontApi, resetSprings])

    useEffect(() => {
      if (prevResolveKeyRef.current === categoryResolveKey) {
        return
      }
      prevResolveKeyRef.current = categoryResolveKey
      if (awaitingCategoryRef.current) {
        goNext()
      }
    }, [categoryResolveKey, goNext])

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
        if (action === 'categorize') {
          awaitingCategoryRef.current = true
          pendingTrackRef.current = track
          onCategorize(track)
          return
        }

        if (action === 'like') {
          onLike(track)
          goNext()
          return
        }

        if (action === 'skip') {
          onSkip?.(track)
          goNext()
          return
        }

        if (action === 'previous') {
          onPrevious?.(track)
          if (indexRef.current <= 0) {
            restoreCurrent()
            return
          }
          goPrevious()
        }
      },
      [goNext, goPrevious, onCategorize, onLike, onPrevious, onSkip, restoreCurrent],
    )

    const bind = useDrag(
      ({ active, movement: [mx, my], velocity: [vx, vy], cancel }) => {
        if (!current || lockedRef.current || awaitingCategoryRef.current) {
          return
        }

        const direction = getDirectionFromMovement(mx, my, SWIPE_THRESHOLD)
        const decision = direction
          ? resolveSwipeAction({
              track: current,
              direction,
              gestureConfig,
              deckIndex: index,
            })
          : null
        setHintAction(active ? (decision?.action ?? null) : null)

        const flick = Math.hypot(vx, vy) > 0.5
        const shouldFly =
          !active &&
          decision !== null &&
          (Math.abs(mx) > SWIPE_THRESHOLD ||
            Math.abs(my) > SWIPE_THRESHOLD ||
            (flick && (Math.abs(mx) > 50 || Math.abs(my) > 50)))

        if (shouldFly && decision) {
          if (decision.action === 'previous' && !decision.canGoPrevious) {
            void frontApi.start({
              x: 0,
              y: 0,
              rot: 0,
              scale: 1,
              opacity: 1,
              config: { tension: 320, friction: 24 },
            })
            setHintAction(null)
            return
          }

          lockedRef.current = true
          const target = flyTarget(decision.direction)
          cancel()

          void frontApi.start({
            ...target,
            opacity: 0,
            scale: 1.04,
            config: { tension: 170, friction: 16, clamp: true },
            onRest: () => {
              finishAction(decision.action, decision.track)
            },
          })

          if (decision.action !== 'categorize' && decision.action !== 'previous') {
            void backApi.start({
              y: 0,
              scale: 1,
              opacity: 1,
              config: { tension: 240, friction: 20 },
            })
          }
          return
        }

        if (active) {
          void frontApi.start({
            x: mx,
            y: my,
            rot: mx / 20 + my / 36,
            scale: 1.03,
            opacity: 1,
            immediate: true,
          })
          void backApi.start({
            scale: 0.97 + Math.min(Math.hypot(mx, my) / 1800, 0.03),
            y: 14 - Math.min(Math.hypot(mx, my) / 40, 10),
            opacity: 1,
            immediate: true,
          })
          return
        }

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
              resetSprings()
              setIndex(0)
            }}
          >
            Начать сначала
          </button>
        </div>
      )
    }

    return (
      <div className="relative mx-auto mb-10 h-[460px] max-h-[52vh] w-full max-w-sm overflow-hidden">
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
          hintAction={hintAction}
          zIndex={2}
          playback={playback}
        />

        <div className="pointer-events-none absolute inset-x-0 -bottom-9 flex flex-wrap justify-center gap-x-5 gap-y-1 text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
          {hints.map((hint) => (
            <span key={hint.dir}>
              {hint.dir} {gestureActionLabels[hint.action]}
            </span>
          ))}
        </div>
      </div>
    )
  },
)

export default SwipeDeck

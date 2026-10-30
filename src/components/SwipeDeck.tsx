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
  SWIPE_VERTICAL_THRESHOLD,
} from '../services/swipeEngine'
import {
  captureAuthSession,
  isAuthSessionCurrent,
} from '../services/auth/sessionEpoch'
import { classifySwipeTrack } from '../services/swipeClassification'
import { SAVE_FAILED_MESSAGE } from '../services/libraryPersistence/statusStore'
import type { GestureConfig, SwipeDirection } from '../types/gesture'
import type { SwipeAction } from '../types/swipe'
import type { Track } from '../types/track'
import { beginSearchFlowCommand, noteSearchFlowEvent } from '../services/continuation/searchFlowDiag.ts'
import { continuationPlaybackCaption } from '../services/continuation/searchSeedPlayback.ts'
import { getPlaybackQueue } from '../services/playbackQueue'
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
   * Skip / previous → плеер. Like сюда не приходит.
   * direction различает Previous и Next (нельзя оба сводить к next).
   */
  onDeckNavigate: (track: Track, direction: 'next' | 'previous') => void
  onTogglePlay?: (track: Track) => void
  playerIsPlaying?: boolean
  /** Пока выключено, колода не прыгает за чужой очередью плеера. */
  syncWithPlayer?: boolean
  /**
   * Трек, который плеер уже играет или держит на паузе.
   * Пока идёт переключение на другую композицию, здесь null: Pause чужой песни не показываем.
   */
  audibleTrackId?: string | null
  /** Карточка, для которой GlobalPlayer уже готовит источник. */
  startingTrackId?: string | null
  playback?: PlaybackState | null
  /**
   * Трек GlobalPlayer. В browse-режиме поиска, если это не текущая карточка,
   * показываем только подпись (playback-колода сама следует за плеером).
   */
  nowPlaying?: { id: string; title: string; artist: string } | null
  playbackContextType?: string
  /**
   * Рекомендательная сессия: жест «дальше» на последней карточке
   * запрашивает Next у плеера, а не упирается в конец ленты.
   */
  advanceAtEnd?: boolean
}

export type SwipeDeckHandle = {
  goNext: () => void
  goPrevious: () => void
}

const SWIPE_COMMIT_MS = 180
/** Визуальный потолок LEFT. Порог жеста считается по реальному движению указателя. */
const LIKE_CARD_SHIFT = 10

function likeCardShift(mx: number, my: number): { x: number; y: number } {
  const distance = Math.hypot(mx, my)
  if (distance <= LIKE_CARD_SHIFT) {
    return { x: mx, y: my }
  }
  const ratio = LIKE_CARD_SHIFT / distance
  return { x: mx * ratio, y: my * ratio }
}

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
      onTogglePlay,
      playerIsPlaying = false,
      syncWithPlayer = true,
      audibleTrackId = null,
      startingTrackId = null,
      playback = null,
      nowPlaying = null,
      playbackContextType = '',
      advanceAtEnd = false,
    },
    ref,
  ) {
    const [index, setIndex] = useState(() => {
      if (!syncWithPlayer || !playerTrackId) {
        return 0
      }
      const found = tracks.findIndex((track) => track.id === playerTrackId)
      return found >= 0 ? found : 0
    })
    const [dragDirection, setDragDirection] = useState<SwipeDirection | null>(
      null,
    )
    const [dragProgress, setDragProgress] = useState(0)
    const [gestureNotice, setGestureNotice] = useState<string | null>(null)
    const [cardMotion, setCardMotion] = useState<'idle' | 'return'>('idle')
    const [heart, setHeart] = useState<{
      phase: 'fly' | 'rest'
      token: number
    } | null>(null)
    const lockedRef = useRef(false)
    const cardMotionRef = useRef<'idle' | 'return'>('idle')
    const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const heartTokenRef = useRef(0)
    const heartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const awaitingCategoryRef = useRef(false)
    const prevResolveKeyRef = useRef(categoryResolveKey)
    const prevCancelKeyRef = useRef(categoryCancelKey)
    const indexRef = useRef(index)
    const prevPlayerTrackIdRef = useRef<string | null>(null)
    const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    /** Пропуск sync сразу после нашей навигации (player ещё догоняет). */
    const ignorePlayerSyncRef = useRef(false)

    const current = tracks[index]
    const next = tracks[index + 1]
    const cardAudible = Boolean(current && audibleTrackId === current.id)
    const cardIsPlayer =
      cardAudible || Boolean(current && startingTrackId === current.id)
    const playbackCaption = cardIsPlayer
      ? null
      : continuationPlaybackCaption({
          contextType: playbackContextType,
          cardTrackId: current?.id ?? null,
          playerTrack: nowPlaying,
        })
    const playbackForCard = playback && cardAudible ? playback : null
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

    const showNotice = useCallback((message: string, holdMs = 1800) => {
      if (noticeTimerRef.current) {
        clearTimeout(noticeTimerRef.current)
      }
      setGestureNotice(message)
      noticeTimerRef.current = setTimeout(() => {
        noticeTimerRef.current = null
        setGestureNotice(null)
        setHeart((current) => (current?.phase === 'rest' ? null : current))
      }, holdMs)
    }, [])

    const dismissHeart = useCallback((token: number, holdMs: number) => {
      if (heartTimerRef.current) {
        clearTimeout(heartTimerRef.current)
      }
      heartTimerRef.current = setTimeout(() => {
        heartTimerRef.current = null
        setHeart((current) => (current?.token === token ? null : current))
      }, holdMs)
    }, [])

    useEffect(() => {
      return () => {
        if (commitTimerRef.current) {
          clearTimeout(commitTimerRef.current)
        }
        if (noticeTimerRef.current) {
          clearTimeout(noticeTimerRef.current)
        }
        if (heartTimerRef.current) {
          clearTimeout(heartTimerRef.current)
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
      (
        nextIndex: number,
        notifyPlayer: boolean,
        direction: 'next' | 'previous',
      ) => {
        clearDragVisual()
        lockedRef.current = false
        awaitingCategoryRef.current = false
        resetSprings()
        indexRef.current = nextIndex
        setIndex(nextIndex)

        const track = tracks[nextIndex]
        if (notifyPlayer && track) {
          ignorePlayerSyncRef.current = true
          beginSearchFlowCommand('SwipeDeck.onDeckNavigate')
          noteSearchFlowEvent({
            source: 'SwipeDeck.onDeckNavigate',
            trackId: track.id,
            currentIndex: nextIndex,
            nextSource: direction === 'previous' ? 'queue' : 'search-result',
            detail: `deckIndex=${nextIndex};dir=${direction};sync=${syncWithPlayer ? 'on' : 'off'}`,
          })
          onDeckNavigate(track, direction)
        }
      },
      [clearDragVisual, onDeckNavigate, resetSprings, syncWithPlayer, tracks],
    )

    const goNext = useCallback(
      (notifyPlayer: boolean) => {
        // Playback-колода: индекс ведёт плеер (syncWithPlayer), не локальный jump.
        if (notifyPlayer && syncWithPlayer) {
          const currentTrack = tracks[indexRef.current] ?? tracks[tracks.length - 1]
          if (!currentTrack) {
            lockedRef.current = false
            clearDragVisual()
            resetSprings()
            return
          }
          beginSearchFlowCommand('SwipeDeck.goNext→player')
          noteSearchFlowEvent({
            source: 'SwipeDeck.goNext',
            trackId: currentTrack.id,
            currentIndex: indexRef.current,
            nextSource: 'continuation',
            detail: advanceAtEnd ? 'sync→AudioPlayer.next' : 'sync→AudioPlayer.next',
          })
          onDeckNavigate(currentTrack, 'next')
          lockedRef.current = false
          clearDragVisual()
          resetSprings()
          return
        }

        const nextIndex = indexRef.current + 1
        if (nextIndex >= tracks.length) {
          const currentTrack = tracks[indexRef.current]
          if (advanceAtEnd && notifyPlayer && currentTrack) {
            beginSearchFlowCommand('SwipeDeck.advanceAtEnd')
            noteSearchFlowEvent({
              source: 'SwipeDeck.advanceAtEnd',
              trackId: currentTrack.id,
              currentIndex: indexRef.current,
              nextSource: 'continuation',
              detail: 'last-card→AudioPlayer.next',
            })
            onDeckNavigate(currentTrack, 'next')
            lockedRef.current = false
            clearDragVisual()
            resetSprings()
            return
          }
          lockedRef.current = false
          clearDragVisual()
          resetSprings()
          setIndex(tracks.length)
          indexRef.current = tracks.length
          return
        }
        jumpToIndex(nextIndex, notifyPlayer, 'next')
      },
      [
        advanceAtEnd,
        clearDragVisual,
        jumpToIndex,
        onDeckNavigate,
        resetSprings,
        syncWithPlayer,
        tracks,
      ],
    )

    const goPrevious = useCallback(
      (notifyPlayer: boolean) => {
        if (notifyPlayer && syncWithPlayer) {
          // Индекс колоды может временно расходиться (exhausted / lag);
          // Previous всегда ведёт плеер по единой queue history.
          const currentTrack =
            tracks[indexRef.current] ?? tracks[0] ?? null
          if (!currentTrack) {
            lockedRef.current = false
            clearDragVisual()
            resetSprings()
            return
          }
          beginSearchFlowCommand('SwipeDeck.goPrevious→player')
          noteSearchFlowEvent({
            source: 'SwipeDeck.goPrevious',
            trackId: currentTrack.id,
            currentIndex: indexRef.current,
            nextSource: 'queue',
            detail: 'sync→AudioPlayer.previous',
          })
          onDeckNavigate(currentTrack, 'previous')
          lockedRef.current = false
          clearDragVisual()
          resetSprings()
          return
        }

        if (indexRef.current <= 0) {
          lockedRef.current = false
          clearDragVisual()
          resetSprings()
          return
        }
        jumpToIndex(indexRef.current - 1, notifyPlayer, 'previous')
      },
      [clearDragVisual, jumpToIndex, onDeckNavigate, resetSprings, syncWithPlayer, tracks],
    )

    useImperativeHandle(
      ref,
      () => ({
        goNext: () => goNext(true),
        goPrevious: () => goPrevious(true),
      }),
      [goNext, goPrevious],
    )

    /**
     * Колода следует за плеером только когда сменился сам трек плеера
     * (кнопки Next/Previous, skip/previous или естественный конец трека).
     * Like не меняет индекс и playerTrackId, поэтому сохранение и
     * обновление списка не сдвигают карточку.
     */
    useEffect(() => {
      if (!syncWithPlayer) {
        prevPlayerTrackIdRef.current = playerTrackId
        return
      }
      if (ignorePlayerSyncRef.current) {
        ignorePlayerSyncRef.current = false
        prevPlayerTrackIdRef.current = playerTrackId
        return
      }

      const playerChanged = prevPlayerTrackIdRef.current !== playerTrackId
      prevPlayerTrackIdRef.current = playerTrackId
      if (!playerChanged || !playerTrackId || tracks.length === 0) {
        return
      }

      const playerIndex = tracks.findIndex((track) => track.id === playerTrackId)
      if (playerIndex < 0 || playerIndex === indexRef.current) {
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
    }, [playerTrackId, tracks, resetSprings, clearDragVisual, syncWithPlayer])

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

        if (action === 'like') {
          // Like классифицируется в обработчике жеста и не двигает колоду.
          return
        }

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
              canGoPrevious: syncWithPlayer
                ? indexRef.current > 0 ||
                  Boolean(getPlaybackQueue().peekPrevious())
                : undefined,
            })
          : null

        if (active) {
          if (cardMotionRef.current !== 'idle') {
            cardMotionRef.current = 'idle'
            setCardMotion('idle')
          }
          setDragDirection(direction)
          setDragProgress(progress)
          // Реальный mx/my решает порог. На LEFT карточка сдвигается не больше LIKE_CARD_SHIFT.
          const likeDrag = mx < 0 && Math.abs(mx) >= Math.abs(my)
          const horizontal = Math.abs(mx) >= Math.abs(my)
          if (likeDrag) {
            const shift = likeCardShift(mx, my)
            frontApi.set({
              x: shift.x,
              y: shift.y,
              rot: 0,
              scale: 1,
              opacity: 1,
            })
          } else {
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
          }
          return
        }

        // Gesture ended
        const flick = Math.hypot(vx, vy) > 0.35
        const likeDistance =
          decision?.action === 'like' && Math.abs(mx) >= SWIPE_VERTICAL_THRESHOLD
        const passed =
          Math.abs(mx) > SWIPE_THRESHOLD ||
          Math.abs(my) > SWIPE_VERTICAL_THRESHOLD ||
          likeDistance ||
          (flick && (Math.abs(mx) > 32 || Math.abs(my) > 32))

        const springBack = () => {
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
        }

        const settleLikeCard = () => {
          clearDragVisual()
          frontApi.set({ x: 0, y: 0, rot: 0, scale: 1, opacity: 1 })
          backApi.set({ x: 0, y: 14, rot: 0, scale: 0.96, opacity: 1 })
        }

        if (last && decision && passed) {
          if (decision.action === 'previous' && !decision.canGoPrevious) {
            springBack()
            return
          }

          if (decision.action === 'like') {
            lockedRef.current = true
            cardMotionRef.current = 'return'
            setCardMotion('return')
            settleLikeCard()
            const token = heartTokenRef.current + 1
            heartTokenRef.current = token
            const likeSession = captureAuthSession()
            const result = classifySwipeTrack(decision.track, 'like')
            const saved = result.kind === 'applied' ? result.saved : undefined
            window.requestAnimationFrame(() => {
              lockedRef.current = false
            })
            if (heartTimerRef.current) {
              clearTimeout(heartTimerRef.current)
              heartTimerRef.current = null
            }
            const finishLike = (ok: boolean) => {
              if (heartTokenRef.current !== token) {
                return
              }
              // Logout / смена аккаунта: не показывать успех/ошибку чужой сессии.
              if (!isAuthSessionCurrent(likeSession)) {
                setHeart(null)
                return
              }
              if (!ok) {
                setHeart(null)
                showNotice(SAVE_FAILED_MESSAGE, 3200)
                return
              }
              const reduceMotion = window.matchMedia?.(
                '(prefers-reduced-motion: reduce)',
              ).matches
              const phase = reduceMotion ? 'rest' : 'fly'
              setHeart({ phase, token })
              showNotice('В избранном')
              if (phase === 'fly') {
                dismissHeart(token, 1100)
              }
            }
            if (!saved) {
              finishLike(false)
              return
            }
            void saved.then(finishLike, () => finishLike(false))
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

        const releasedLike = mx < 0 && Math.abs(mx) >= Math.abs(my)
        if (releasedLike) {
          settleLikeCard()
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
        // filterTaps вешает click capture и глушит Play, если прошлый жест не был tap
        // (порог 3px). Кнопка тогда не доходит до обработчика, нижний плеер — доходит.
        filterTaps: false,
        // На touchscreen `true` ставит preventScrollAxis: 'y'. DragEngine
        // тогда отменяет жест, как только ось становится вертикальной,
        // и UP/DOWN не доходят до commit. Карточка уже с touch-action: none,
        // поэтому страница не скроллится от жеста на ней, а остальной экран скроллится.
        preventScroll: false,
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
      <div className="swipe-deck" data-card-motion={cardMotion}>
        {gestureNotice ? (
          <p
            role="status"
            className="pointer-events-none absolute left-1/2 top-1 z-20 max-w-[16rem] -translate-x-1/2 rounded-full bg-[var(--color-surface)] px-3 py-1 text-center text-xs font-medium text-[var(--color-fg)] shadow"
          >
            {gestureNotice}
          </p>
        ) : null}

        {playbackCaption ? (
          <p
            role="status"
            className="swipe-deck-caption text-xs text-[var(--color-muted)]"
          >
            {playbackCaption}
          </p>
        ) : null}

        <SwipeDirectionHints
          gestureConfig={gestureConfig}
          activeDirection={dragDirection}
          progress={dragProgress}
        />

        <div className="swipe-stage-slot">
          <div className="swipe-stage">
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
              onTogglePlay={onTogglePlay ? () => onTogglePlay(current) : undefined}
              isPlaying={playerIsPlaying && cardAudible}
              isStarting={Boolean(
                current &&
                  startingTrackId === current.id &&
                  !(playerIsPlaying && cardAudible),
              )}
            />
          </div>
          {heart ? (
            <div
              key={heart.token}
              className={`swipe-heart absolute left-1/2 top-[18%] z-30 ${
                heart.phase === 'fly' ? 'swipe-heart-fly' : 'swipe-heart-rest'
              }`}
              data-heart={heart.phase}
              data-heart-size="152"
              onAnimationEnd={(event) => {
                if (
                  event.target !== event.currentTarget ||
                  event.animationName !== 'swipe-heart-fly'
                ) {
                  return
                }
                const token = heart.token
                setHeart((currentHeart) =>
                  currentHeart?.token === token && currentHeart.phase === 'fly'
                    ? null
                    : currentHeart,
                )
              }}
            >
              <svg viewBox="0 0 120 120" aria-hidden="true" className="h-full w-full">
                <path
                  d="M60 96.5S28.2 76 16.4 56.6C8.6 43.8 12.8 27 28.2 21.4c9.8-3.6 19.2-1 25.4 7.2 1.8 2.4 6.2 2.4 8 0 6.2-8.2 15.6-10.8 25.4-7.2C103.2 27 107.4 43.8 99.6 56.6 87.8 76 60 96.5 60 96.5z"
                  fill="#e11d48"
                  stroke="#e11d48"
                  strokeWidth="6"
                />
              </svg>
            </div>
          ) : null}
        </div>
      </div>
    )
  },
)

export default SwipeDeck

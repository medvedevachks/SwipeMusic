import { useState } from 'react'
import { Link } from 'react-router-dom'
import { canonicalItemForTrack } from '../../services/canonical/selectors'
import { beginSearchFlowCommand } from '../../services/continuation/searchFlowDiag.ts'
import { openManualSourceAlternatives } from '../../services/runtimeFallback/fallbackUxRuntime'
import { usePlaybackFallbackUxStore } from '../../store/playbackFallbackUxStore'
import { useCanonicalLibraryStore } from '../../store/canonicalLibraryStore'
import { useGlobalPlayerStore } from '../../store/playerStore'
import { getSourceDisplayName } from '../../utils/sourceDisplay'
import {
  MoreIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PreviousIcon,
  RepeatIcon,
  ShuffleIcon,
} from '../icons'
import PlayerProgressBar from './PlayerProgressBar'
import PlayerVolumeControl from './PlayerVolumeControl'

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const

/**
 * Панель в потоке оболочки, под прокручиваемой колонкой.
 * Управление только через GlobalPlayerStore / AudioPlayer.
 */
export default function BottomPlayer() {
  const currentTrack = useGlobalPlayerStore((s) => s.currentTrack)
  const pendingTrack = useGlobalPlayerStore((s) => s.pendingTrack)
  const activeCandidate = useGlobalPlayerStore((s) => s.activeCandidate)
  const playing = useGlobalPlayerStore((s) => s.playing)
  const buffering = useGlobalPlayerStore((s) => s.buffering)
  const loading = useGlobalPlayerStore((s) => s.loading)
  const currentTime = useGlobalPlayerStore((s) => s.currentTime)
  const duration = useGlobalPlayerStore((s) => s.duration)
  const volume = useGlobalPlayerStore((s) => s.volume)
  const muted = useGlobalPlayerStore((s) => s.muted)
  const playbackRate = useGlobalPlayerStore((s) => s.playbackRate)
  const repeatMode = useGlobalPlayerStore((s) => s.repeatMode)
  const shuffleMode = useGlobalPlayerStore((s) => s.shuffleMode)
  const error = useGlobalPlayerStore((s) => s.error)
  const ownsPlayerError = usePlaybackFallbackUxStore((s) => s.model.ownsPlayerError)
  const shownTrack = pendingTrack ?? currentTrack
  const alternativeCount = useCanonicalLibraryStore((s) => {
    if (!shownTrack) {
      return 0
    }
    return canonicalItemForTrack(s, shownTrack)?.copies.length ?? 0
  })
  const queueLength = useGlobalPlayerStore((s) => s.queue.length)

  const pause = useGlobalPlayerStore((s) => s.pause)
  const resume = useGlobalPlayerStore((s) => s.resume)
  const next = useGlobalPlayerStore((s) => s.next)
  const previous = useGlobalPlayerStore((s) => s.previous)
  const seek = useGlobalPlayerStore((s) => s.seek)
  const setVolume = useGlobalPlayerStore((s) => s.setVolume)
  const toggleMute = useGlobalPlayerStore((s) => s.toggleMute)
  const setMuted = useGlobalPlayerStore((s) => s.setMuted)
  const cycleRepeatMode = useGlobalPlayerStore((s) => s.cycleRepeatMode)
  const toggleShuffle = useGlobalPlayerStore((s) => s.toggleShuffle)
  const setPlaybackRate = useGlobalPlayerStore((s) => s.setPlaybackRate)

  const [menuOpen, setMenuOpen] = useState(false)
  /** Во время switch показываем запрошенный трек, но не как «уже играет». */
  const displayTrack = pendingTrack ?? currentTrack
  const switching = Boolean(pendingTrack)
  const canControl = Boolean(currentTrack) && !switching
  const busy = switching || buffering || loading
  const launching = busy && !playing

  const sourceLabel = displayTrack
    ? getSourceDisplayName(displayTrack.sourceId)
    : null
  const candidateHint = switching ? null : (activeCandidate?.type ?? null)

  const coverStyle = displayTrack?.coverUrl
    ? { backgroundImage: `url(${displayTrack.coverUrl})` }
    : {
        backgroundColor: displayTrack?.coverColor ?? 'var(--color-accent)',
      }

  const repeatActive = repeatMode !== 'OFF'
  const togglePlay = () => {
    if (playing) {
      pause()
      return
    }
    void resume()
  }

  return (
    <div className="px-2 pb-1.5 sm:px-3" role="region" aria-label="Глобальный плеер">
      <div className="player-grid deck-panel mx-auto max-w-3xl px-3 py-1.5 text-[var(--color-player-fg)]">
          <Link
            to="/queue"
            className="player-meta flex min-w-0 items-center gap-2.5"
            title={displayTrack ? 'Открыть очередь / сейчас играет' : undefined}
          >
            <div
              className="player-cover shrink-0 rounded-xl bg-cover bg-center ring-1 ring-[var(--deck-panel-border)]"
              style={coverStyle}
              aria-hidden
            />
            <div className="min-w-0 leading-tight">
              <p className="truncate text-sm font-semibold tracking-tight text-[var(--color-player-fg)]">
                {displayTrack?.title ?? 'Ничего не играет'}
              </p>
              <p className="truncate text-xs text-[var(--color-player-muted)]">
                {displayTrack?.artist ?? 'Выберите трек'}
              </p>
              {busy ? (
                <p className="truncate text-[10px] text-[var(--color-accent)]">
                  {switching ? 'Переключение…' : 'Загрузка…'}
                </p>
              ) : sourceLabel ? (
                <p className="truncate text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--color-accent)]">
                  {sourceLabel}
                </p>
              ) : null}
            </div>
          </Link>

          <div className="player-transport">
            <div className="player-keys">
              <button
                type="button"
                className="deck-key deck-key-utility player-extra"
                aria-label="Shuffle"
                aria-pressed={shuffleMode === 'ON'}
                disabled={!canControl}
                onClick={toggleShuffle}
              >
                <ShuffleIcon className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="deck-key deck-key-side"
                aria-label="Предыдущий"
                disabled={!canControl}
                onClick={() => void previous()}
              >
                <PreviousIcon className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="deck-key deck-key-primary"
                aria-label={playing ? 'Пауза' : launching ? 'Запуск' : 'Воспроизведение'}
                aria-pressed={playing}
                aria-busy={launching || undefined}
                disabled={!canControl}
                onClick={togglePlay}
              >
                {playing ? (
                  <PauseIcon />
                ) : launching ? (
                  <span className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" />
                ) : (
                  <PlayIcon className="translate-x-0.5" />
                )}
              </button>
              <button
                type="button"
                className="deck-key deck-key-side"
                aria-label="Следующий"
                disabled={!canControl}
                onClick={() => {
                  beginSearchFlowCommand('BottomPlayer.Next')
                  void next()
                }}
              >
                <NextIcon className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="deck-key deck-key-utility player-extra"
                aria-label={`Repeat: ${repeatMode}`}
                aria-pressed={repeatActive}
                disabled={!canControl}
                onClick={cycleRepeatMode}
              >
                <span className="relative">
                  <RepeatIcon className="h-4 w-4" />
                  {repeatMode === 'ONE' ? (
                    <span className="absolute -right-1.5 -top-1.5 text-[9px] font-semibold leading-none">
                      1
                    </span>
                  ) : null}
                </span>
              </button>
            </div>
            <div className="player-progress-wide">
              <PlayerProgressBar
                currentTime={currentTime}
                duration={duration}
                disabled={!canControl || duration <= 0}
                onSeek={seek}
              />
            </div>
          </div>

          <div className="player-tools relative flex items-center justify-end gap-1">
            {candidateHint ? (
              <span
                className="hidden rounded-full border border-[var(--deck-key-border)] bg-[var(--deck-key-fill)] px-2 py-1 text-[10px] uppercase tracking-wide text-[var(--color-player-muted)] lg:inline"
                title="Тип PlaybackCandidate"
              >
                {candidateHint}
              </span>
            ) : null}
            <PlayerVolumeControl
              volume={volume}
              muted={muted}
              onToggleMute={toggleMute}
              onVolumeChange={(nextVolume) => {
                setVolume(nextVolume)
                if (muted && nextVolume > 0) {
                  setMuted(false)
                }
              }}
            />
            <label className="hidden items-center lg:flex">
              <span className="sr-only">Скорость</span>
              <select
                className="deck-select"
                value={playbackRate}
                aria-label="Скорость воспроизведения"
                disabled={!canControl}
                onChange={(event) => setPlaybackRate(Number(event.target.value))}
              >
                {PLAYBACK_RATES.map((rate) => (
                  <option key={rate} value={rate} className="bg-[var(--color-surface)]">
                    {rate}x
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="deck-key deck-key-utility"
              aria-label="Меню плеера"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <MoreIcon className="h-4 w-4" />
            </button>
            {menuOpen ? (
              <div className="deck-menu absolute bottom-12 right-0 z-40 min-w-[10rem] overflow-hidden py-1">
                <Link
                  to="/queue"
                  className="block px-3 py-2 text-sm text-[var(--color-fg)] hover:bg-[var(--color-surface-hover)]"
                  onClick={() => setMenuOpen(false)}
                >
                  Очередь ({queueLength})
                </Link>
                {alternativeCount >= 2 && shownTrack ? (
                  <button
                    type="button"
                    className="block min-h-11 w-full px-3 py-2 text-left text-sm text-[var(--color-fg)] hover:bg-[var(--color-surface-hover)]"
                    onClick={() => {
                      setMenuOpen(false)
                      void openManualSourceAlternatives(shownTrack)
                    }}
                  >
                    Источники композиции
                  </button>
                ) : null}
                <button
                  type="button"
                  className="block w-full px-3 py-2 text-left text-sm text-[var(--color-fg)] hover:bg-[var(--color-surface-hover)]"
                  onClick={() => {
                    toggleShuffle()
                    setMenuOpen(false)
                  }}
                >
                  Shuffle: {shuffleMode}
                </button>
                <button
                  type="button"
                  className="block w-full px-3 py-2 text-left text-sm text-[var(--color-fg)] hover:bg-[var(--color-surface-hover)]"
                  onClick={() => {
                    cycleRepeatMode()
                    setMenuOpen(false)
                  }}
                >
                  Repeat: {repeatMode}
                </button>
                <div className="border-t border-[var(--color-border)] px-3 py-2 lg:hidden">
                  <p className="mb-1 text-[10px] uppercase text-[var(--color-player-muted)]">
                    Скорость
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {PLAYBACK_RATES.map((rate) => (
                      <button
                        key={rate}
                        type="button"
                        className={[
                          'rounded-full border border-[var(--deck-key-border)] px-2 py-1 text-xs',
                          playbackRate === rate
                            ? 'bg-[var(--color-accent)] text-white'
                            : 'bg-[var(--deck-key-fill)] text-[var(--color-fg)]',
                        ].join(' ')}
                        onClick={() => {
                          setPlaybackRate(rate)
                          setMenuOpen(false)
                        }}
                      >
                        {rate}x
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </div>

        <div className="player-progress">
          <PlayerProgressBar
            currentTime={currentTime}
            duration={duration}
            disabled={!canControl || duration <= 0}
            onSeek={seek}
          />
        </div>

        {error && !ownsPlayerError ? (
          <p className="mt-1 truncate text-[11px] text-rose-400" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  )
}

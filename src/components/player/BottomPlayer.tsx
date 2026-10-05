import { useState } from 'react'
import { Link } from 'react-router-dom'
import { canonicalItemForTrack } from '../../services/canonical/selectors'
import { openManualSourceAlternatives } from '../../services/runtimeFallback/fallbackUxRuntime'
import { usePlaybackFallbackUxStore } from '../../store/playbackFallbackUxStore'
import { useCanonicalLibraryStore } from '../../store/canonicalLibraryStore'
import { useGlobalPlayerStore } from '../../store/playerStore'
import { getSourceDisplayName } from '../../utils/sourceDisplay'
import PlayerProgressBar from './PlayerProgressBar'
import PlayerVolumeControl from './PlayerVolumeControl'

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const

/**
 * Persistent bottom player — вне маршрутов, поверх BottomNav.
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

  const sourceLabel = displayTrack
    ? getSourceDisplayName(displayTrack.sourceId)
    : null
  const candidateHint = switching ? null : (activeCandidate?.type ?? null)

  const coverStyle = displayTrack?.coverUrl
    ? { backgroundImage: `url(${displayTrack.coverUrl})` }
    : {
        backgroundColor: displayTrack?.coverColor ?? 'var(--color-accent)',
      }

  const repeatLabel =
    repeatMode === 'ONE' ? '🔂' : repeatMode === 'ALL' ? '🔁' : '🔁'
  const repeatActive = repeatMode !== 'OFF'

  return (
    <div
      className="border-t border-white/10 bg-[#121212]/95 text-white backdrop-blur-md"
      style={{ minHeight: 88 }}
      role="region"
      aria-label="Глобальный плеер"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-1 px-3 py-2 sm:px-4">
        <div className="flex items-center gap-2 sm:gap-4">
          {/* Left: art + meta */}
          <Link
            to="/queue"
            className="flex min-w-0 flex-1 items-center gap-2.5 transition-opacity hover:opacity-90 sm:max-w-[28%]"
            title={displayTrack ? 'Открыть очередь / сейчас играет' : undefined}
          >
            <div
              className="h-12 w-12 shrink-0 rounded bg-cover bg-center shadow-md sm:h-14 sm:w-14"
              style={coverStyle}
              aria-hidden
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-white">
                {displayTrack?.title ?? 'Ничего не играет'}
              </p>
              <p className="truncate text-xs text-white/55">
                {displayTrack
                  ? `${displayTrack.artist}${sourceLabel ? ` · ${sourceLabel}` : ''}`
                  : 'Выберите трек'}
              </p>
              {busy ? (
                <p className="text-[10px] text-[var(--color-accent)]">
                  {switching ? 'Переключение…' : 'Загрузка…'}
                </p>
              ) : null}
            </div>
          </Link>

          {/* Center: transport + progress */}
          <div className="hidden min-w-0 flex-[1.4] flex-col items-center gap-1 md:flex">
            <div className="flex items-center gap-1 sm:gap-2">
              <button
                type="button"
                className={[
                  'flex h-8 w-8 items-center justify-center rounded-full text-sm transition-colors',
                  shuffleMode === 'ON'
                    ? 'text-[var(--color-accent)]'
                    : 'text-white/60 hover:text-white',
                ].join(' ')}
                aria-label="Shuffle"
                aria-pressed={shuffleMode === 'ON'}
                disabled={!canControl}
                onClick={toggleShuffle}
              >
                ⇄
              </button>
              <button
                type="button"
                className="flex h-9 w-9 items-center justify-center rounded-full text-white/80 transition-colors hover:text-white disabled:opacity-40"
                aria-label="Предыдущий"
                disabled={!canControl}
                onClick={() => void previous()}
              >
                ⏮
              </button>
              <button
                type="button"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-base font-semibold text-black transition hover:scale-105 disabled:opacity-40"
                aria-label={playing ? 'Пауза' : 'Воспроизведение'}
                disabled={!canControl}
                onClick={() => {
                  if (playing) {
                    pause()
                    return
                  }
                  void resume()
                }}
              >
                {playing ? '⏸' : '▶'}
              </button>
              <button
                type="button"
                className="flex h-9 w-9 items-center justify-center rounded-full text-white/80 transition-colors hover:text-white disabled:opacity-40"
                aria-label="Следующий"
                disabled={!canControl}
                onClick={() => void next()}
              >
                ⏭
              </button>
              <button
                type="button"
                className={[
                  'flex h-8 w-8 items-center justify-center rounded-full text-sm transition-colors',
                  repeatActive
                    ? 'text-[var(--color-accent)]'
                    : 'text-white/60 hover:text-white',
                ].join(' ')}
                aria-label={`Repeat: ${repeatMode}`}
                disabled={!canControl}
                onClick={cycleRepeatMode}
              >
                {repeatLabel}
                {repeatMode === 'ONE' ? (
                  <span className="ml-0.5 text-[9px]">1</span>
                ) : null}
              </button>
            </div>
            <PlayerProgressBar
              currentTime={currentTime}
              duration={duration}
              disabled={!canControl || duration <= 0}
              onSeek={seek}
            />
          </div>

          {/* Mobile transport */}
          <div className="flex items-center gap-1 md:hidden">
            <button
              type="button"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-black disabled:opacity-40"
              aria-label={playing ? 'Пауза' : 'Воспроизведение'}
              disabled={!canControl}
              onClick={() => {
                if (playing) {
                  pause()
                  return
                }
                void resume()
              }}
            >
              {playing ? '⏸' : '▶'}
            </button>
            <button
              type="button"
              className="flex h-9 w-9 items-center justify-center rounded-full text-white/80 disabled:opacity-40"
              aria-label="Следующий"
              disabled={!canControl}
              onClick={() => void next()}
            >
              ⏭
            </button>
          </div>

          {/* Right: volume / rate / menu */}
          <div className="relative flex shrink-0 items-center justify-end gap-1 sm:min-w-[22%] sm:gap-2">
            {candidateHint ? (
              <span
                className="hidden rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-white/55 lg:inline"
                title="Тип PlaybackCandidate"
              >
                {candidateHint}
              </span>
            ) : null}
            {sourceLabel ? (
              <span
                className="hidden max-w-[7rem] truncate text-[10px] text-white/45 xl:inline"
                title={sourceLabel}
              >
                {sourceLabel}
              </span>
            ) : null}
            <PlayerVolumeControl
              volume={volume}
              muted={muted}
              onToggleMute={toggleMute}
              onVolumeChange={(next) => {
                setVolume(next)
                if (muted && next > 0) {
                  setMuted(false)
                }
              }}
            />
            <label className="hidden items-center gap-1 text-[10px] text-white/55 lg:flex">
              <span className="sr-only">Скорость</span>
              <select
                className="rounded-md border border-white/15 bg-transparent px-1.5 py-1 text-[11px] text-white/80 outline-none hover:border-white/30"
                value={playbackRate}
                aria-label="Скорость воспроизведения"
                disabled={!canControl}
                onChange={(event) =>
                  setPlaybackRate(Number(event.target.value))
                }
              >
                {PLAYBACK_RATES.map((rate) => (
                  <option key={rate} value={rate} className="bg-[#181818]">
                    {rate}x
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-white/60 transition-colors hover:bg-white/10 hover:text-white"
              aria-label="Меню плеера"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              ⋯
            </button>
            {menuOpen ? (
              <div className="absolute bottom-10 right-0 z-40 min-w-[10rem] overflow-hidden rounded-xl border border-white/10 bg-[#181818] py-1 shadow-xl">
                <Link
                  to="/queue"
                  className="block px-3 py-2 text-sm text-white/85 hover:bg-white/10"
                  onClick={() => setMenuOpen(false)}
                >
                  Очередь ({queueLength})
                </Link>
                {alternativeCount >= 2 && shownTrack ? (
                  <button
                    type="button"
                    className="block min-h-11 w-full px-3 py-2 text-left text-sm text-white/85 hover:bg-white/10"
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
                  className="block w-full px-3 py-2 text-left text-sm text-white/85 hover:bg-white/10"
                  onClick={() => {
                    toggleShuffle()
                    setMenuOpen(false)
                  }}
                >
                  Shuffle: {shuffleMode}
                </button>
                <button
                  type="button"
                  className="block w-full px-3 py-2 text-left text-sm text-white/85 hover:bg-white/10"
                  onClick={() => {
                    cycleRepeatMode()
                    setMenuOpen(false)
                  }}
                >
                  Repeat: {repeatMode}
                </button>
                <div className="border-t border-white/10 px-3 py-2 lg:hidden">
                  <p className="mb-1 text-[10px] uppercase text-white/40">
                    Скорость
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {PLAYBACK_RATES.map((rate) => (
                      <button
                        key={rate}
                        type="button"
                        className={[
                          'rounded px-2 py-1 text-xs',
                          playbackRate === rate
                            ? 'bg-[var(--color-accent)] text-white'
                            : 'bg-white/10 text-white/70',
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
        </div>

        {/* Mobile progress */}
        <div className="md:hidden">
          <PlayerProgressBar
            currentTime={currentTime}
            duration={duration}
            disabled={!canControl || duration <= 0}
            onSeek={seek}
          />
        </div>

        {error && !ownsPlayerError ? (
          <p className="truncate text-[11px] text-rose-400" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  )
}

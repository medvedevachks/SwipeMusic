import { create } from 'zustand'
import { getAudioPlayer } from '../services/audioPlayer'
import { attachPlaybackAnalytics } from '../services/playbackAnalytics/attach.ts'
import { noteUserRepeatModeChange } from '../services/catalogPlayback/catalogRepeatPolicy'
import {
  getPlaybackQueue,
  type RepeatMode,
  type ShuffleMode,
} from '../services/playbackQueue'
import type { PlaybackContext } from '../types/playbackContext'
import { NONE_PLAYBACK_CONTEXT } from '../types/playbackContext'
import type { PlayerState } from '../types/player'
import { initialPlayerState } from '../types/player'
import type { Track } from '../types/track'

type PlayerStore = PlayerState & {
  repeatMode: RepeatMode
  shuffleMode: ShuffleMode
  playbackContext: PlaybackContext
  play: (url: string) => Promise<void>
  playTrack: (track: Track) => Promise<void>
  pause: () => void
  resume: () => Promise<void>
  stop: () => void
  seek: (timeSeconds: number) => void
  next: () => Promise<void>
  previous: () => Promise<void>
  setQueue: (
    tracks: Track[],
    startIndex?: number,
    context?: PlaybackContext,
  ) => void
  setPlaybackContext: (context: PlaybackContext) => void
  appendToQueue: (tracks: Track[]) => void
  insertNext: (track: Track) => void
  removeFromQueue: (trackId: string) => void
  moveInQueue: (from: number, to: number) => void
  clearQueue: () => void
  setRepeatMode: (mode: RepeatMode) => void
  setShuffleMode: (mode: ShuffleMode) => void
  cycleRepeatMode: () => void
  toggleShuffle: () => void
  setVolume: (volume: number) => void
  setMuted: (muted: boolean) => void
  toggleMute: () => void
  setPlaybackRate: (rate: number) => void
}

const audioPlayer = getAudioPlayer()
const playbackQueue = getPlaybackQueue()
attachPlaybackAnalytics()

const REPEAT_CYCLE: RepeatMode[] = ['OFF', 'ALL', 'ONE']

export const usePlayerStore = create<PlayerStore>((set, get) => {
  audioPlayer.subscribe((state) => {
    set({
      currentTrack: state.currentTrack,
      pendingTrack: state.pendingTrack,
      activeCandidate: state.activeCandidate,
      playing: state.playing,
      paused: state.paused,
      buffering: state.buffering,
      loading: state.loading,
      currentTime: state.currentTime,
      duration: state.duration,
      progress: state.progress,
      volume: state.volume,
      muted: state.muted,
      playbackRate: state.playbackRate,
      queue: state.queue,
      queueIndex: state.queueIndex,
      error: state.error,
    })
  })

  playbackQueue.subscribe((snapshot) => {
    set({
      queue: snapshot.items,
      queueIndex: snapshot.currentIndex,
      repeatMode: snapshot.repeatMode,
      shuffleMode: snapshot.shuffleMode,
      playbackContext: snapshot.context,
    })
  })

  const queueSnap = playbackQueue.getSnapshot()

  return {
    ...initialPlayerState,
    ...audioPlayer.getState(),
    repeatMode: queueSnap.repeatMode,
    shuffleMode: queueSnap.shuffleMode,
    playbackContext: queueSnap.context ?? NONE_PLAYBACK_CONTEXT,

    play: (url) => audioPlayer.play(url),
    playTrack: (track) => audioPlayer.playTrack(track),
    pause: () => audioPlayer.pause(),
    resume: () => audioPlayer.resume(),
    stop: () => audioPlayer.stop(),
    seek: (timeSeconds) => audioPlayer.seek(timeSeconds),
    next: () => audioPlayer.next(),
    previous: () => audioPlayer.previous(),
    setQueue: (tracks, startIndex, context) =>
      audioPlayer.setQueue(tracks, startIndex, context),
    setPlaybackContext: (context) => playbackQueue.setPlaybackContext(context),
    appendToQueue: (tracks) => audioPlayer.append(tracks),
    insertNext: (track) => audioPlayer.insertNext(track),
    removeFromQueue: (trackId) => playbackQueue.remove(trackId),
    moveInQueue: (from, to) => playbackQueue.move(from, to),
    clearQueue: () => playbackQueue.clear(),
    setRepeatMode: (mode) => {
      noteUserRepeatModeChange(mode)
      playbackQueue.setRepeatMode(mode)
    },
    setShuffleMode: (mode) => playbackQueue.setShuffleMode(mode),
    cycleRepeatMode: () => {
      const current = get().repeatMode
      const index = REPEAT_CYCLE.indexOf(current)
      const next = REPEAT_CYCLE[(index + 1) % REPEAT_CYCLE.length] ?? 'OFF'
      noteUserRepeatModeChange(next)
      playbackQueue.setRepeatMode(next)
    },
    toggleShuffle: () => {
      const next: ShuffleMode = get().shuffleMode === 'ON' ? 'OFF' : 'ON'
      playbackQueue.setShuffleMode(next)
    },
    setVolume: (volume) => audioPlayer.setVolume(volume),
    setMuted: (muted) => audioPlayer.setMuted(muted),
    toggleMute: () => audioPlayer.toggleMute(),
    setPlaybackRate: (rate) => audioPlayer.setPlaybackRate(rate),
  }
})

/** Алиас: единый Global Player Store (persistent bottom player). */
export const useGlobalPlayerStore = usePlayerStore

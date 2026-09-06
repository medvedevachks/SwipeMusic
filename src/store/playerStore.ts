import { create } from 'zustand'
import { getAudioPlayer } from '../services/audioPlayer'
import {
  getPlaybackQueue,
  type RepeatMode,
  type ShuffleMode,
} from '../services/playbackQueue'
import type { PlayerState } from '../types/player'
import { initialPlayerState } from '../types/player'
import type { Track } from '../types/track'

type PlayerStore = PlayerState & {
  repeatMode: RepeatMode
  shuffleMode: ShuffleMode
  play: (url: string) => Promise<void>
  playTrack: (track: Track) => Promise<void>
  pause: () => void
  resume: () => Promise<void>
  stop: () => void
  seek: (timeSeconds: number) => void
  next: () => Promise<void>
  previous: () => Promise<void>
  setQueue: (tracks: Track[], startIndex?: number) => void
  appendToQueue: (tracks: Track[]) => void
  insertNext: (track: Track) => void
  removeFromQueue: (trackId: string) => void
  moveInQueue: (from: number, to: number) => void
  clearQueue: () => void
  setRepeatMode: (mode: RepeatMode) => void
  setShuffleMode: (mode: ShuffleMode) => void
  setVolume: (volume: number) => void
}

const audioPlayer = getAudioPlayer()
const playbackQueue = getPlaybackQueue()

export const usePlayerStore = create<PlayerStore>((set) => {
  audioPlayer.subscribe((state) => {
    set({
      currentTrack: state.currentTrack,
      playing: state.playing,
      paused: state.paused,
      currentTime: state.currentTime,
      duration: state.duration,
      volume: state.volume,
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
    })
  })

  const queueSnap = playbackQueue.getSnapshot()

  return {
    ...initialPlayerState,
    ...audioPlayer.getState(),
    repeatMode: queueSnap.repeatMode,
    shuffleMode: queueSnap.shuffleMode,

    play: (url) => audioPlayer.play(url),
    playTrack: (track) => audioPlayer.playTrack(track),
    pause: () => audioPlayer.pause(),
    resume: () => audioPlayer.resume(),
    stop: () => audioPlayer.stop(),
    seek: (timeSeconds) => audioPlayer.seek(timeSeconds),
    next: () => audioPlayer.next(),
    previous: () => audioPlayer.previous(),
    setQueue: (tracks, startIndex) => audioPlayer.setQueue(tracks, startIndex),
    appendToQueue: (tracks) => audioPlayer.append(tracks),
    insertNext: (track) => audioPlayer.insertNext(track),
    removeFromQueue: (trackId) => playbackQueue.remove(trackId),
    moveInQueue: (from, to) => playbackQueue.move(from, to),
    clearQueue: () => playbackQueue.clear(),
    setRepeatMode: (mode) => playbackQueue.setRepeatMode(mode),
    setShuffleMode: (mode) => playbackQueue.setShuffleMode(mode),
    setVolume: (volume) => audioPlayer.setVolume(volume),
  }
})

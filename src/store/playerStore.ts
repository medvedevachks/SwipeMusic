import { create } from 'zustand'
import { getAudioPlayer } from '../services/audioPlayer'
import type { PlayerState } from '../types/player'
import { initialPlayerState } from '../types/player'
import type { Track } from '../types/track'

type PlayerStore = PlayerState & {
  play: (url: string) => Promise<void>
  playTrack: (track: Track) => Promise<void>
  pause: () => void
  resume: () => Promise<void>
  stop: () => void
  seek: (timeSeconds: number) => void
  next: () => Promise<void>
  previous: () => Promise<void>
  setQueue: (tracks: Track[], startIndex?: number) => void
  setVolume: (volume: number) => void
}

const audioPlayer = getAudioPlayer()

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

  return {
    ...initialPlayerState,
    ...audioPlayer.getState(),

    play: (url) => audioPlayer.play(url),
    playTrack: (track) => audioPlayer.playTrack(track),
    pause: () => audioPlayer.pause(),
    resume: () => audioPlayer.resume(),
    stop: () => audioPlayer.stop(),
    seek: (timeSeconds) => audioPlayer.seek(timeSeconds),
    next: () => audioPlayer.next(),
    previous: () => audioPlayer.previous(),
    setQueue: (tracks, startIndex) => audioPlayer.setQueue(tracks, startIndex),
    setVolume: (volume) => audioPlayer.setVolume(volume),
  }
})

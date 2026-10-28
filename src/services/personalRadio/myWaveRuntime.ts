import { getAudioPlayer } from '../audioPlayer/index.ts'
import { getPlaybackQueue } from '../playbackQueue/PlaybackQueue.ts'
import {
  commitRecommendationSeed,
  pickRecommendationStart,
} from '../recommendation/sessionRuntime.ts'
import { MY_WAVE_ID, MY_WAVE_TITLE, decideRadioToggle, type RadioPlan } from './recommend.ts'

/**
 * «Моя волна» на едином Recommendation Engine.
 * buildPersonalRadio на живом пути не вызывается (код сохранён в recommend.ts).
 */
export async function toggleLiveMyWave(): Promise<RadioPlan> {
  const player = getAudioPlayer().getState()
  const queue = getPlaybackQueue()
  const context = queue.getPlaybackContext()
  const decision = decideRadioToggle({
    radioActive: context.type === 'radio' && context.id === MY_WAVE_ID,
    playing: player.playing,
    paused: player.paused,
    queueLength: queue.getItems().length,
  })

  if (decision === 'pause') {
    getAudioPlayer().pause()
    return {
      status: 'ready',
      origin: 'recommendations',
      tracks: [],
      startIndex: 0,
      message: 'Пауза',
    }
  }
  if (decision === 'resume') {
    try {
      await getAudioPlayer().resume()
    } catch {
      // autoplay
    }
    return {
      status: 'ready',
      origin: 'recommendations',
      tracks: [],
      startIndex: 0,
      message: MY_WAVE_TITLE,
    }
  }

  const picked = await pickRecommendationStart({ mode: 'wave' })
  if (!picked.ok) {
    const status =
      picked.emptyReason === 'no-seed' || picked.emptyReason === 'no-sources'
        ? picked.emptyReason === 'no-sources'
          ? 'no-source'
          : 'no-likes'
        : picked.emptyReason === 'error' || picked.emptyReason === 'timeout'
          ? 'error'
          : 'unavailable'
    return {
      status,
      origin: null,
      tracks: [],
      startIndex: 0,
      message: picked.message,
    }
  }

  commitRecommendationSeed({ mode: 'wave', track: picked.track })
  try {
    await getAudioPlayer().playTrack(picked.track)
  } catch {
    // Браузерный autoplay: очередь и карточка уже на рекомендации.
  }

  return {
    status: 'ready',
    origin: 'recommendations',
    tracks: [picked.track],
    startIndex: 0,
    message: MY_WAVE_TITLE,
  }
}

import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  confirmFallbackPlayback,
  dismissFallbackPrompt,
  ensureFallbackUxBindings,
  playAlternativeCopy,
  recheckFallbackCopy,
  retryFallbackPlayback,
} from '../../services/runtimeFallback/fallbackUxRuntime.ts'
import type { FallbackUxAction } from '../../services/runtimeFallback/fallbackUxModel.ts'
import { sourcesPath } from '../../services/runtimeFallback/fallbackUxModel.ts'
import { usePlaybackFallbackUxStore } from '../../store/playbackFallbackUxStore.ts'
import PlaybackAlternativesSheet from './PlaybackAlternativesSheet'

export default function PlaybackFallbackHost() {
  const model = usePlaybackFallbackUxStore((state) => state.model)
  const navigate = useNavigate()

  useEffect(() => {
    ensureFallbackUxBindings()
  }, [])

  async function onAction(action: FallbackUxAction): Promise<void> {
    switch (action.type) {
      case 'dismiss':
        dismissFallbackPrompt(model.kind)
        return
      case 'confirm-play':
        await confirmFallbackPlayback()
        return
      case 'play':
        await playAlternativeCopy(action.sourceTrackKey)
        return
      case 'sources':
        dismissFallbackPrompt('terminal')
        navigate(sourcesPath())
        return
      case 'recheck':
        await recheckFallbackCopy(action.sourceId, action.sourceTrackKey)
        return
      case 'retry-playback':
        await retryFallbackPlayback()
        return
      default:
        return
    }
  }

  return (
    <>
      {model.kind === 'notice' && model.noticeText ? (
        <div
          className="border-t border-white/10 bg-[#121212] px-3 py-2 text-white"
          role="status"
        >
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
            <p className="text-sm">{model.noticeText}</p>
            <button
              type="button"
              className="min-h-11 shrink-0 rounded-lg px-3 text-sm text-white/80"
              onClick={() => dismissFallbackPrompt('notice')}
            >
              Закрыть
            </button>
          </div>
        </div>
      ) : null}
      <PlaybackAlternativesSheet model={model} onAction={(action) => void onAction(action)} />
    </>
  )
}

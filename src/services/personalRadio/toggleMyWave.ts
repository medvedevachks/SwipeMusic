import {
  MY_WAVE_TITLE,
  buildPersonalRadio,
  decideRadioToggle,
  type RadioLibraryItem,
  type RadioPlan,
  type RadioSearchPort,
  type RadioSelection,
} from './recommend.ts'
import { getRadioSelection } from './radioSelection.ts'
import type { UserTasteProfile } from '../taste/types.ts'

export type MyWaveDeps = {
  readTransport: () => {
    radioActive: boolean
    playing: boolean
    paused: boolean
    queueLength: number
  }
  pause: () => void
  resume: () => Promise<void>
  play: (plan: RadioPlan) => Promise<void>
  loadLibrary: () => RadioLibraryItem[]
  loadPort: () => Promise<RadioSearchPort>
  readRotation: () => number
  storeRotation: (value: number) => void
  selection?: RadioSelection
  loadTasteProfile?: () => Promise<UserTasteProfile | null>
}

export async function toggleMyWave(deps: MyWaveDeps): Promise<RadioPlan> {
  const decision = decideRadioToggle(deps.readTransport())
  if (decision === 'pause') {
    deps.pause()
    return {
      status: 'ready',
      origin: 'recommendations',
      tracks: [],
      startIndex: 0,
      message: 'Пауза',
    }
  }
  if (decision === 'resume') {
    await deps.resume()
    return {
      status: 'ready',
      origin: 'recommendations',
      tracks: [],
      startIndex: 0,
      message: MY_WAVE_TITLE,
    }
  }

  const rotation = deps.readRotation()
  const selection = deps.selection ?? getRadioSelection()
  const taste = selection === 'taste' ? await deps.loadTasteProfile?.() ?? null : null
  if (selection === 'taste' && !taste) {
    return {
      status: 'error',
      origin: null,
      tracks: [],
      startIndex: 0,
      message: 'Профиль вкуса недоступен.',
    }
  }
  const plan = await buildPersonalRadio(deps.loadLibrary(), await deps.loadPort(), {
    rotation,
    ...(taste ? { selection: 'taste' as const, taste } : {}),
  })
  if (plan.status !== 'ready' && plan.status !== 'favorites') {
    return plan
  }
  try {
    await deps.play(plan)
  } catch {
    return {
      status: 'error',
      origin: null,
      tracks: [],
      startIndex: 0,
      message: 'Не удалось начать воспроизведение.',
    }
  }
  deps.storeRotation(rotation + 1)
  return plan
}

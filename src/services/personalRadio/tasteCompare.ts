import { buildPersonalRadio, type RadioLibraryItem, type RadioPlan, type RadioSearchPort } from './recommend.ts'
import type { UserTasteProfile } from '../taste/types.ts'

export type RadioPlanSnapshot = {
  status: RadioPlan['status']
  origin: RadioPlan['origin']
  trackIds: string[]
  artists: string[]
  uniqueArtists: number
  heardShare: number
  negativeInResults: number
}

export type RadioComparison = {
  legacy: RadioPlanSnapshot
  taste: RadioPlanSnapshot
  artistSearchOnly: true
}

/**
 * Сравнение не читает и не меняет PlaybackQueue.
 * Оба прогона используют rotation 0 и один и тот же порт.
 */
export async function comparePersonalRadio(
  items: readonly RadioLibraryItem[],
  profile: UserTasteProfile,
  port: RadioSearchPort,
  signal?: AbortSignal,
): Promise<RadioComparison> {
  const legacy = await buildPersonalRadio(items, port, { rotation: 0, signal })
  const taste = await buildPersonalRadio(items, port, {
    rotation: 0,
    signal,
    selection: 'taste',
    taste: profile,
  })
  return {
    legacy: snapshotPlan(legacy, profile),
    taste: snapshotPlan(taste, profile),
    artistSearchOnly: true,
  }
}

function snapshotPlan(plan: RadioPlan, profile: UserTasteProfile): RadioPlanSnapshot {
  const heard = new Set<string>()
  const negative = new Set<string>()
  for (const track of profile.tracks) {
    const title = `${(track.label?.artist ?? '').trim().toLowerCase()}|${(track.label?.title ?? '').trim().toLowerCase()}`
    if (track.signals.some((signal) => signal.origin === 'playback-listen' && signal.weight > 0)) {
      heard.add(title)
    }
    if (track.signals.some((signal) =>
      (signal.origin === 'canonical-dislike' || signal.origin === 'canonical-hidden') && signal.weight < 0)) {
      negative.add(title)
    }
  }
  const artists = plan.tracks.map((track) => track.artist.trim().toLowerCase()).filter(Boolean)
  const heardCount = plan.tracks.filter((track) => heard.has(`${track.artist.trim().toLowerCase()}|${track.title.trim().toLowerCase()}`)).length
  const negativeCount = plan.tracks.filter((track) => negative.has(`${track.artist.trim().toLowerCase()}|${track.title.trim().toLowerCase()}`)).length
  return {
    status: plan.status,
    origin: plan.origin,
    trackIds: plan.tracks.map((track) => track.id),
    artists,
    uniqueArtists: new Set(artists).size,
    heardShare: plan.tracks.length === 0 ? 0 : heardCount / plan.tracks.length,
    negativeInResults: negativeCount,
  }
}

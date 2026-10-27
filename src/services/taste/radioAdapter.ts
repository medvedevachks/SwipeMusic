import { isDemoSourceId } from '../../sources/demoSource.ts'
import type { RadioLibraryItem } from '../personalRadio/recommend.ts'
import type { TasteTrackProfile, UserTasteProfile } from './types.ts'

/**
 * Форма семян для существующего buildPersonalRadio.
 * Живой путь «Моей волны» этот адаптер не вызывает и алгоритм радио не меняет.
 * Новые canonical id здесь не создаются.
 */
export function tasteProfileAsRadioLibrary(profile: UserTasteProfile): RadioLibraryItem[] {
  const items: RadioLibraryItem[] = []
  for (const track of profile.tracks) {
    if (track.key.kind !== 'canonical') {
      continue
    }
    if (!track.signals.some((signal) => signal.origin === 'canonical-like' && signal.weight > 0)) {
      continue
    }
    const copies = track.copies.filter((copy) => copy.externalId && !isDemoSourceId(copy.sourceId))
    if (copies.length === 0) {
      continue
    }
    items.push({
      canonicalId: track.key.canonicalTrackId,
      title: track.label?.title ?? '',
      artist: track.label?.artist ?? '',
      liked: true,
      disliked: hasNegative(track, 'canonical-dislike'),
      hidden: hasNegative(track, 'canonical-hidden'),
      playCount: listenCount(track),
      skipped: skipCount(track),
      lastPlayed: track.lastPlayed,
      copies: copies.map((copy) => ({
        sourceId: copy.sourceId,
        externalId: copy.externalId,
        title: track.label?.title ?? '',
        artist: track.label?.artist ?? '',
      })),
    })
  }
  return items
}

function hasNegative(track: TasteTrackProfile, origin: 'canonical-dislike' | 'canonical-hidden'): boolean {
  return track.signals.some((signal) => signal.origin === origin && signal.weight < 0)
}

function listenCount(track: TasteTrackProfile): number {
  const listen = track.signals.find((signal) => signal.origin === 'playback-listen' || signal.origin === 'library-play-count')
  return listen && listen.weight > 0 ? 1 : 0
}

function skipCount(track: TasteTrackProfile): number {
  return track.signals.some((signal) => signal.origin === 'playback-early-skip' || signal.origin === 'canonical-skip-count')
    ? 1
    : 0
}

/** Демо-источник не считается музыкой пользователя. */
export const DEMO_SOURCE_ID = 'mock'

export function isDemoSourceId(sourceId: string): boolean {
  return sourceId === DEMO_SOURCE_ID
}

export function withoutDemoTracks<T extends { sourceId: string }>(tracks: readonly T[]): T[] {
  return tracks.filter((track) => !isDemoSourceId(track.sourceId))
}

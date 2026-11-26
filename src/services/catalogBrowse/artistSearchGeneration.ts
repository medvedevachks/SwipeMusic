/**
 * Поколение поиска исполнителей: отсекает устаревшие ответы
 * при новом query / clear.
 */

let artistSearchGeneration = 0

export function bumpArtistSearchGeneration(): number {
  artistSearchGeneration += 1
  return artistSearchGeneration
}

export function getArtistSearchGeneration(): number {
  return artistSearchGeneration
}

export function isCurrentArtistSearchGeneration(generation: number): boolean {
  return generation === artistSearchGeneration
}

/** Только для unit-тестов. */
export function resetArtistSearchGenerationForTests(): void {
  artistSearchGeneration = 0
}

/** Совпадает с AudioPlayer: autoplay-block не ошибка UI. */
export function isAutoplayBlockedError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }

  const name = error.name
  const message = error.message.toLowerCase()

  return (
    name === 'NotAllowedError' ||
    message.includes("user didn't interact") ||
    message.includes('play() failed because the user') ||
    message.includes('notallowederror')
  )
}

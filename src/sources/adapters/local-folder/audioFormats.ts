/**
 * Поддерживаемые аудиоформаты локальной библиотеки.
 * Добавление расширения — только здесь.
 */
export const LOCAL_AUDIO_EXTENSIONS = [
  'mp3',
  'flac',
  'wav',
  'm4a',
  'ogg',
  'aac',
] as const

export type LocalAudioExtension = (typeof LOCAL_AUDIO_EXTENSIONS)[number]

const EXTENSION_SET = new Set<string>(
  LOCAL_AUDIO_EXTENSIONS.map((ext) => ext.toLowerCase()),
)

/** Имя файла без расширения. */
export function stripFileExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.')
  if (lastDot <= 0) {
    return fileName
  }
  return fileName.slice(0, lastDot)
}

/** Расширение файла в нижнем регистре без точки, либо null. */
export function getFileExtension(fileName: string): string | null {
  const lastDot = fileName.lastIndexOf('.')
  if (lastDot <= 0 || lastDot === fileName.length - 1) {
    return null
  }
  return fileName.slice(lastDot + 1).toLowerCase()
}

export function isSupportedAudioFileName(fileName: string): boolean {
  const ext = getFileExtension(fileName)
  return ext !== null && EXTENSION_SET.has(ext)
}

const MIME_BY_EXTENSION: Record<LocalAudioExtension, string> = {
  mp3: 'audio/mpeg',
  flac: 'audio/flac',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  aac: 'audio/aac',
}

/** MIME для ObjectURL — пустой File.type часто даёт MEDIA_ERR_SRC_NOT_SUPPORTED. */
export function mimeTypeForAudioFileName(fileName: string): string | null {
  const ext = getFileExtension(fileName)
  if (!ext || !EXTENSION_SET.has(ext)) {
    return null
  }
  return MIME_BY_EXTENSION[ext as LocalAudioExtension]
}

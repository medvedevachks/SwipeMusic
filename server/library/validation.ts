import type {
  CategoryDto,
  CategoryIconId,
  GestureConfig,
  SwipeAction,
  TrackSnapshot,
} from './types.ts'
import { DEFAULT_GESTURE_CONFIG } from './types.ts'

export type FieldErrors = Record<string, string>

export type Parsed<T> =
  | { ok: true; value: T }
  | { ok: false; fields: FieldErrors }

const ICONS = new Set<CategoryIconId>([
  'heart',
  'car',
  'muscle',
  'moon',
  'party',
  'book',
  'music',
  'star',
])

const SWIPE_ACTIONS = new Set<SwipeAction>(['categorize', 'like', 'skip', 'previous'])
const DIRECTIONS = ['left', 'right', 'up', 'down'] as const

const SECRET_KEY = /token|secret|password|credential|oauth/i
const FORBIDDEN_KEYS = new Set([
  'userId',
  'user_id',
  'playbackUrl',
  'streamUrl',
  'audioUrl',
  'accessToken',
  'refreshToken',
  'token',
  'password',
  'passwordHash',
  'session',
  'oauth',
  'authorization',
])

export type CategoryWrite = {
  id: string | null
  name: string
  icon: CategoryIconId
  color: string
  description: string
  createdAt: string | null
  updatedAt: string | null
  sortOrder: number | null
  favorite: boolean
  system: boolean
}

export type CategoryPatch = {
  name?: string
  icon?: CategoryIconId
  color?: string
  description?: string
  sortOrder?: number
  favorite?: boolean
  updatedAt?: string
}

export type TrackWrite = {
  sourceId: string
  externalId: string
  title: string
  artist: string
  album: string | null
  albumProvided: boolean
  genre: string | null
  genreProvided: boolean
  year: number | null
  yearProvided: boolean
  durationMs: number | null
  durationProvided: boolean
  coverUrl: string | null
  coverUrlProvided: boolean
  coverColor: string | null
  coverColorProvided: boolean
  previewUrl: string | null
  previewUrlProvided: boolean
  tags: string[] | null
  addedAt: string | null
  lastPlayed: string | null
  lastPlayedProvided: boolean
  playCount: number | null
  liked: boolean | null
  likedAt: string | null
  likedAtProvided: boolean
  disliked: boolean | null
  skipped: number | null
  notes: string | null
  notesProvided: boolean
  favorite: boolean | null
  hidden: boolean | null
  customMetadata: Record<string, unknown> | null
  categories: string[] | null
}

export type HistoryWrite = {
  id: string | null
  track: TrackSnapshot
  action: SwipeAction
  category: CategoryDto | null
  createdAt: string | null
  sourceId: string
}

function hasControlChar(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 31 || code === 127) {
      return true
    }
  }
  return false
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function fail(fields: FieldErrors): Parsed<never> {
  return { ok: false, fields }
}

export function rejectSecrets(value: unknown, label = 'body'): string | null {
  return secretKey(value, label, 0)
}

function secretKey(value: unknown, path: string, depth: number): string | null {
  if (depth > 6 || !value || typeof value !== 'object') {
    return null
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = secretKey(value[index], `${path}[${index}]`, depth + 1)
      if (found) {
        return found
      }
    }
    return null
  }

  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(key) || SECRET_KEY.test(key)) {
      return key
    }
    const found = secretKey(
      (value as Record<string, unknown>)[key],
      `${path}.${key}`,
      depth + 1,
    )
    if (found) {
      return found
    }
  }
  return null
}

export function isClientId(value: string): boolean {
  return value.length > 0 && value.length <= 200 && !value.includes('/') && !hasControlChar(value)
}

function isTrackPart(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 300 &&
    !value.includes(':') &&
    !value.includes('/') &&
    !hasControlChar(value)
  )
}

export function splitTrackId(trackId: string): { sourceId: string; externalId: string } | null {
  const index = trackId.indexOf(':')
  if (index <= 0 || index >= trackId.length - 1) {
    return null
  }
  const sourceId = trackId.slice(0, index)
  const externalId = trackId.slice(index + 1)
  if (!isTrackPart(sourceId) || externalId.length === 0 || externalId.length > 300) {
    return null
  }
  if (hasControlChar(externalId)) {
    return null
  }
  return { sourceId, externalId }
}

function readIso(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) {
    return null
  }
  const time = Date.parse(value)
  if (Number.isNaN(time)) {
    return null
  }
  return new Date(time).toISOString()
}

function readColor(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const color = value.trim()
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color) ? color.toLowerCase() : null
}

function readIcon(value: unknown): CategoryIconId | null {
  return typeof value === 'string' && ICONS.has(value as CategoryIconId)
    ? (value as CategoryIconId)
    : null
}

export function validateCategoryCreate(body: unknown, now: string): Parsed<CategoryWrite> {
  const record = asRecord(body)
  if (!record) {
    return fail({ body: 'Ожидается объект' })
  }
  const secret = rejectSecrets(record)
  if (secret) {
    return fail({ [secret]: 'Поле запрещено' })
  }

  const fields: FieldErrors = {}
  const name = typeof record.name === 'string' ? record.name.trim() : ''
  if (!name || name.length > 80) {
    fields.name = 'Название от 1 до 80 символов'
  }
  const icon = readIcon(record.icon)
  if (!icon) {
    fields.icon = 'Неизвестная иконка'
  }
  const color = readColor(record.color)
  if (!color) {
    fields.color = 'Цвет в формате #rgb или #rrggbb'
  }

  let description = ''
  if ('description' in record) {
    if (typeof record.description !== 'string' || record.description.trim().length > 500) {
      fields.description = 'Описание не длиннее 500 символов'
    } else {
      description = record.description.trim()
    }
  }

  let id: string | null = null
  if ('id' in record && record.id != null) {
    if (typeof record.id !== 'string' || !isClientId(record.id)) {
      fields.id = 'Некорректный id'
    } else {
      id = record.id
    }
  }

  let sortOrder: number | null = null
  if ('sortOrder' in record && record.sortOrder != null) {
    if (!isSortOrder(record.sortOrder)) {
      fields.sortOrder = 'Некорректный порядок'
    } else {
      sortOrder = record.sortOrder
    }
  }

  const favorite = 'favorite' in record ? record.favorite : false
  if (typeof favorite !== 'boolean') {
    fields.favorite = 'Ожидается boolean'
  }
  const system = 'system' in record ? record.system : false
  if (typeof system !== 'boolean') {
    fields.system = 'Ожидается boolean'
  }

  const createdAt = readOptionalIso(record, 'createdAt', fields, now)
  const updatedAt = readOptionalIso(record, 'updatedAt', fields, now)
  if (Object.keys(fields).length > 0 || !icon || !color) {
    return fail(fields)
  }

  return {
    ok: true,
    value: {
      id,
      name,
      icon,
      color,
      description,
      createdAt,
      updatedAt,
      sortOrder,
      favorite: favorite === true,
      system: system === true,
    },
  }
}

export function validateCategoryPatch(body: unknown): Parsed<CategoryPatch> {
  const record = asRecord(body)
  if (!record) {
    return fail({ body: 'Ожидается объект' })
  }
  const secret = rejectSecrets(record)
  if (secret) {
    return fail({ [secret]: 'Поле запрещено' })
  }
  if ('system' in record || 'id' in record || 'createdAt' in record) {
    return fail({ body: 'Это поле менять нельзя' })
  }

  const fields: FieldErrors = {}
  const patch: CategoryPatch = {}
  if ('name' in record) {
    const name = typeof record.name === 'string' ? record.name.trim() : ''
    if (!name || name.length > 80) {
      fields.name = 'Название от 1 до 80 символов'
    } else {
      patch.name = name
    }
  }
  if ('icon' in record) {
    const icon = readIcon(record.icon)
    if (!icon) {
      fields.icon = 'Неизвестная иконка'
    } else {
      patch.icon = icon
    }
  }
  if ('color' in record) {
    const color = readColor(record.color)
    if (!color) {
      fields.color = 'Цвет в формате #rgb или #rrggbb'
    } else {
      patch.color = color
    }
  }
  if ('description' in record) {
    if (typeof record.description !== 'string' || record.description.trim().length > 500) {
      fields.description = 'Описание не длиннее 500 символов'
    } else {
      patch.description = record.description.trim()
    }
  }
  if ('sortOrder' in record) {
    if (!isSortOrder(record.sortOrder)) {
      fields.sortOrder = 'Некорректный порядок'
    } else {
      patch.sortOrder = record.sortOrder
    }
  }
  if ('favorite' in record) {
    if (typeof record.favorite !== 'boolean') {
      fields.favorite = 'Ожидается boolean'
    } else {
      patch.favorite = record.favorite
    }
  }
  if ('updatedAt' in record) {
    const updatedAt = readIso(record.updatedAt)
    if (!updatedAt) {
      fields.updatedAt = 'Некорректная дата'
    } else {
      patch.updatedAt = updatedAt
    }
  }
  if (Object.keys(patch).length === 0) {
    fields.body = 'Нет полей для обновления'
  }
  if (Object.keys(fields).length > 0) {
    return fail(fields)
  }
  return { ok: true, value: patch }
}

export function validateTrackWrite(trackId: string, body: unknown): Parsed<TrackWrite> {
  const record = asRecord(body)
  if (!record) {
    return fail({ body: 'Ожидается объект' })
  }
  const parts = splitTrackId(trackId)
  if (!parts) {
    return fail({ trackId: 'Ожидается sourceId:externalId' })
  }
  const secret = rejectSecrets(record)
  if (secret) {
    return fail({ [secret]: 'Поле запрещено' })
  }

  const fields: FieldErrors = {}
  const sourceId = typeof record.sourceId === 'string' ? record.sourceId : ''
  const externalId = typeof record.externalId === 'string' ? record.externalId : ''
  if (sourceId !== parts.sourceId || externalId !== parts.externalId) {
    fields.trackId = 'sourceId и externalId должны совпадать с id трека'
  }
  const title = typeof record.title === 'string' ? record.title.trim() : ''
  const artist = typeof record.artist === 'string' ? record.artist.trim() : ''
  if (!title || title.length > 300) {
    fields.title = 'Название от 1 до 300 символов'
  }
  if (!artist || artist.length > 300) {
    fields.artist = 'Исполнитель от 1 до 300 символов'
  }

  const album = readOptionalText(record, 'album', fields, 300)
  const genre = readOptionalText(record, 'genre', fields, 120)
  const coverColor = readOptionalText(record, 'coverColor', fields, 32)
  const coverUrl = readOptionalText(record, 'coverUrl', fields, 2000)
  const previewUrl = readOptionalText(record, 'previewUrl', fields, 2000)
  const notes = readOptionalText(record, 'notes', fields, 2000)
  const year = readOptionalInt(record, 'year', fields, 0, 9999)
  const durationMs = readOptionalInt(record, 'durationMs', fields, 0, 24 * 60 * 60 * 1000)
  const playCount = readOptionalInt(record, 'playCount', fields, 0, 1_000_000_000)
  const skipped = readOptionalInt(record, 'skipped', fields, 0, 1_000_000_000)
  const liked = readOptionalBool(record, 'liked', fields)
  const disliked = readOptionalBool(record, 'disliked', fields)
  const favorite = readOptionalBool(record, 'favorite', fields)
  const hidden = readOptionalBool(record, 'hidden', fields)
  const addedAt = readOptionalIsoField(record, 'addedAt', fields)
  const lastPlayed = readNullableIso(record, 'lastPlayed', fields)
  const likedAt = readNullableIso(record, 'likedAt', fields)

  let tags: string[] | null = null
  if ('tags' in record) {
    tags = readTags(record.tags, fields)
  }

  let customMetadata: Record<string, unknown> | null = null
  if ('customMetadata' in record) {
    const metadata = asRecord(record.customMetadata)
    if (!metadata) {
      fields.customMetadata = 'Ожидается объект'
    } else if (JSON.stringify(metadata).length > 8000) {
      fields.customMetadata = 'Слишком большой объект'
    } else {
      customMetadata = metadata
    }
  }

  let categories: string[] | null = null
  if ('categories' in record) {
    if (!Array.isArray(record.categories) || record.categories.length > 50) {
      fields.categories = 'Ожидается список id категорий'
    } else if (record.categories.some((item) => typeof item !== 'string' || !isClientId(item))) {
      fields.categories = 'Некорректный id категории'
    } else {
      categories = [...new Set(record.categories)]
    }
  }

  if (Object.keys(fields).length > 0) {
    return fail(fields)
  }

  return {
    ok: true,
    value: {
      sourceId,
      externalId,
      title,
      artist,
      album: album.value,
      albumProvided: album.provided,
      genre: genre.value,
      genreProvided: genre.provided,
      year: year.value,
      yearProvided: year.provided,
      durationMs: durationMs.value,
      durationProvided: durationMs.provided,
      coverUrl: coverUrl.value,
      coverUrlProvided: coverUrl.provided,
      coverColor: coverColor.value,
      coverColorProvided: coverColor.provided,
      previewUrl: previewUrl.value,
      previewUrlProvided: previewUrl.provided,
      tags,
      addedAt,
      lastPlayed: lastPlayed.value,
      lastPlayedProvided: lastPlayed.provided,
      playCount: playCount.value,
      liked: liked.value,
      likedAt: likedAt.value,
      likedAtProvided: likedAt.provided,
      disliked: disliked.value,
      skipped: skipped.value,
      notes: notes.value,
      notesProvided: notes.provided,
      favorite: favorite.value,
      hidden: hidden.value,
      customMetadata,
      categories,
    },
  }
}

export function validateHistoryWrite(body: unknown): Parsed<HistoryWrite> {
  const record = asRecord(body)
  if (!record) {
    return fail({ body: 'Ожидается объект' })
  }
  const secret = rejectSecrets(record)
  if (secret) {
    return fail({ [secret]: 'Поле запрещено' })
  }

  const fields: FieldErrors = {}
  const track = readTrackSnapshot(record.track, fields)
  const action = record.action
  if (typeof action !== 'string' || !SWIPE_ACTIONS.has(action as SwipeAction)) {
    fields.action = 'Неизвестное действие'
  }

  let id: string | null = null
  if ('id' in record && record.id != null) {
    if (typeof record.id !== 'string' || !isClientId(record.id)) {
      fields.id = 'Некорректный id'
    } else {
      id = record.id
    }
  }

  let sourceId = track?.sourceId ?? ''
  if ('sourceId' in record && record.sourceId != null) {
    if (typeof record.sourceId !== 'string' || record.sourceId !== track?.sourceId) {
      fields.sourceId = 'sourceId должен совпадать с треком'
    } else {
      sourceId = record.sourceId
    }
  }

  const createdAt = readOptionalIsoField(record, 'createdAt', fields)
  let category: CategoryDto | null = null
  if ('category' in record && record.category != null) {
    const parsed = validateCategoryCreate(record.category, createdAt ?? new Date().toISOString())
    if (!parsed.ok || !parsed.value.id) {
      fields.category = 'Некорректный снимок категории'
    } else {
      category = {
        id: parsed.value.id,
        name: parsed.value.name,
        icon: parsed.value.icon,
        color: parsed.value.color,
        description: parsed.value.description,
        createdAt: parsed.value.createdAt ?? new Date().toISOString(),
        updatedAt: parsed.value.updatedAt ?? new Date().toISOString(),
        sortOrder: parsed.value.sortOrder ?? 0,
        favorite: parsed.value.favorite,
        system: parsed.value.system,
      }
    }
  }

  if (!track || typeof action !== 'string' || !SWIPE_ACTIONS.has(action as SwipeAction) || Object.keys(fields).length > 0) {
    return fail(fields)
  }

  return {
    ok: true,
    value: {
      id,
      track,
      action: action as SwipeAction,
      category,
      createdAt,
      sourceId,
    },
  }
}

export function validateSettingsPatch(body: unknown): Parsed<GestureConfig> {
  const record = asRecord(body)
  if (!record) {
    return fail({ body: 'Ожидается объект' })
  }
  const secret = rejectSecrets(record)
  if (secret) {
    return fail({ [secret]: 'Поле запрещено' })
  }
  const extra = Object.keys(record).filter((key) => key !== 'gestureConfig')
  if (extra.length > 0) {
    return fail({ [extra[0]]: 'Поле запрещено' })
  }
  const gesture = asRecord(record.gestureConfig)
  if (!gesture) {
    return fail({ gestureConfig: 'Ожидается раскладка жестов' })
  }
  const gestureExtra = Object.keys(gesture).filter(
    (key) => !DIRECTIONS.includes(key as (typeof DIRECTIONS)[number]),
  )
  if (gestureExtra.length > 0) {
    return fail({ gestureConfig: 'Лишнее направление' })
  }

  const next: GestureConfig = { ...DEFAULT_GESTURE_CONFIG }
  const fields: FieldErrors = {}
  for (const direction of DIRECTIONS) {
    const value = gesture[direction]
    if (typeof value !== 'string' || !SWIPE_ACTIONS.has(value as SwipeAction)) {
      fields[direction] = 'Неизвестное действие'
    } else {
      next[direction] = value as SwipeAction
    }
  }
  if (Object.keys(fields).length > 0) {
    return fail(fields)
  }
  return { ok: true, value: next }
}

export function parseHistoryLimit(raw: string | null): Parsed<number> {
  if (raw == null || raw === '') {
    return { ok: true, value: 100 }
  }
  if (!/^\d+$/.test(raw)) {
    return fail({ limit: 'Некорректный limit' })
  }
  const limit = Number(raw)
  if (limit < 1 || limit > 200) {
    return fail({ limit: 'limit от 1 до 200' })
  }
  return { ok: true, value: limit }
}

function isSortOrder(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= -100_000 && value <= 1_000_000
}

function readOptionalIso(
  record: Record<string, unknown>,
  key: string,
  fields: FieldErrors,
  fallback: string,
): string | null {
  if (!(key in record) || record[key] == null) {
    return fallback
  }
  const iso = readIso(record[key])
  if (!iso) {
    fields[key] = 'Некорректная дата'
    return null
  }
  return iso
}

function readOptionalIsoField(
  record: Record<string, unknown>,
  key: string,
  fields: FieldErrors,
): string | null {
  if (!(key in record) || record[key] == null) {
    return null
  }
  const iso = readIso(record[key])
  if (!iso) {
    fields[key] = 'Некорректная дата'
    return null
  }
  return iso
}

function readNullableIso(
  record: Record<string, unknown>,
  key: string,
  fields: FieldErrors,
): { provided: boolean; value: string | null } {
  if (!(key in record)) {
    return { provided: false, value: null }
  }
  if (record[key] == null) {
    return { provided: true, value: null }
  }
  const iso = readIso(record[key])
  if (!iso) {
    fields[key] = 'Некорректная дата'
    return { provided: true, value: null }
  }
  return { provided: true, value: iso }
}

function readOptionalText(
  record: Record<string, unknown>,
  key: string,
  fields: FieldErrors,
  max: number,
): { provided: boolean; value: string | null } {
  if (!(key in record)) {
    return { provided: false, value: null }
  }
  if (record[key] == null) {
    return { provided: true, value: null }
  }
  if (typeof record[key] !== 'string' || record[key].trim().length > max) {
    fields[key] = 'Некорректное значение'
    return { provided: true, value: null }
  }
  const text = record[key].trim()
  return { provided: true, value: text || null }
}

function readOptionalInt(
  record: Record<string, unknown>,
  key: string,
  fields: FieldErrors,
  min: number,
  max: number,
): { provided: boolean; value: number | null } {
  if (!(key in record) || record[key] == null) {
    return { provided: false, value: null }
  }
  const value = record[key]
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    fields[key] = 'Некорректное число'
    return { provided: true, value: null }
  }
  return { provided: true, value }
}

function readOptionalBool(
  record: Record<string, unknown>,
  key: string,
  fields: FieldErrors,
): { provided: boolean; value: boolean | null } {
  if (!(key in record)) {
    return { provided: false, value: null }
  }
  if (typeof record[key] !== 'boolean') {
    fields[key] = 'Ожидается boolean'
    return { provided: true, value: null }
  }
  return { provided: true, value: record[key] }
}

function readTags(value: unknown, fields: FieldErrors): string[] | null {
  if (!Array.isArray(value) || value.length > 32) {
    fields.tags = 'Некорректные теги'
    return null
  }
  const tags: string[] = []
  for (const item of value) {
    if (typeof item !== 'string' || !item.trim() || item.trim().length > 64) {
      fields.tags = 'Некорректные теги'
      return null
    }
    tags.push(item.trim())
  }
  return tags
}

function readTrackSnapshot(value: unknown, fields: FieldErrors): TrackSnapshot | null {
  const record = asRecord(value)
  if (!record) {
    fields.track = 'Ожидается трек'
    return null
  }
  const secret = rejectSecrets(record)
  if (secret) {
    fields[secret] = 'Поле запрещено'
    return null
  }
  const id = typeof record.id === 'string' ? record.id : ''
  const parts = splitTrackId(id)
  const sourceId = typeof record.sourceId === 'string' ? record.sourceId : ''
  const externalId = typeof record.externalId === 'string' ? record.externalId : ''
  const title = typeof record.title === 'string' ? record.title.trim() : ''
  const artist = typeof record.artist === 'string' ? record.artist.trim() : ''
  if (!parts || sourceId !== parts.sourceId || externalId !== parts.externalId || !title || !artist) {
    fields.track = 'Некорректный снимок трека'
    return null
  }

  const track: TrackSnapshot = { id, sourceId, externalId, title, artist }
  const album = readOptionalText(record, 'album', fields, 300)
  const genre = readOptionalText(record, 'genre', fields, 120)
  const coverColor = readOptionalText(record, 'coverColor', fields, 32)
  const coverUrl = readOptionalText(record, 'coverUrl', fields, 2000)
  const previewUrl = readOptionalText(record, 'previewUrl', fields, 2000)
  const year = readOptionalInt(record, 'year', fields, 0, 9999)
  const durationMs = readOptionalInt(record, 'durationMs', fields, 0, 24 * 60 * 60 * 1000)
  if (album.provided && album.value) track.album = album.value
  if (genre.provided && genre.value) track.genre = genre.value
  if (coverColor.provided && coverColor.value) track.coverColor = coverColor.value
  if (coverUrl.provided) track.coverUrl = coverUrl.value
  if (previewUrl.provided) track.previewUrl = previewUrl.value
  if (year.provided && year.value != null) track.year = year.value
  if (durationMs.provided && durationMs.value != null) track.durationMs = durationMs.value
  if ('tags' in record) {
    const tags = readTags(record.tags, fields)
    if (tags) track.tags = tags
  }
  return track
}

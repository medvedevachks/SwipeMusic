/**
 * DEV-ACCEPTANCE-05: изолированная SQLite + пользователь + короткие WAV.
 * Пароль только в .data/dev-acceptance/PASSWORD.txt (каталог в .gitignore).
 *
 * Запуск:
 *   node --experimental-strip-types scripts/dev-acceptance-prepare.mts
 */
import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDatabase } from '../server/db/database.ts'
import { hashPassword, verifyPassword } from '../server/auth/password.ts'
import { createPasswordWorkLimiter } from '../server/auth/passwordWork.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = join(root, '.data', 'dev-acceptance')
const audioDir = join(dataDir, 'audio')
const dbPath = join(dataDir, 'swipemusic.sqlite')
const passwordPath = join(dataDir, 'PASSWORD.txt')
const loginPath = join(dataDir, 'LOGIN.txt')

const EMAIL = 'dev-acceptance@swipemusic.local'
const SOURCE_ID = 'dev-acceptance'
const now = new Date().toISOString()

function writeToneWav(filePath: string, durationSec: number, freqHz: number): void {
  const sampleRate = 22_050
  const numSamples = Math.floor(sampleRate * durationSec)
  const dataSize = numSamples * 2
  const buffer = Buffer.alloc(44 + dataSize)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)
  for (let i = 0; i < numSamples; i += 1) {
    const t = i / sampleRate
    const envelope = Math.min(1, t * 8, (durationSec - t) * 8)
    const sample = Math.sin(2 * Math.PI * freqHz * t) * 0.35 * envelope * 32_767
    buffer.writeInt16LE(Math.max(-32_767, Math.min(32_767, Math.round(sample))), 44 + i * 2)
  }
  writeFileSync(filePath, buffer)
}

function seedLiked(
  db: ReturnType<typeof openDatabase>,
  userId: string,
  input: {
    canonicalId: string
    externalId: string
    title: string
    artist: string
    lastPlayed?: string
    playCount?: number
  },
): void {
  const lastPlayed = input.lastPlayed ?? now
  const playCount = input.playCount ?? 2
  db.prepare(`
    INSERT INTO user_canonical_tracks (
      user_id, id, title, artist, album, duration_ms, artwork_url, created_at, updated_at
    ) VALUES (?, ?, ?, ?, NULL, 2000, NULL, ?, ?)
  `).run(userId, input.canonicalId, input.title, input.artist, now, now)
  db.prepare(`
    INSERT INTO user_canonical_library_tracks (
      user_id, canonical_track_id, added_at, last_played, play_count, liked, liked_at,
      disliked, skipped, notes, favorite, hidden, custom_metadata_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, 1, ?, 0, 0, '', 0, 0, '{}', ?)
  `).run(userId, input.canonicalId, now, lastPlayed, playCount, now, now)
  db.prepare(`
    INSERT INTO user_track_source_copies (
      user_id, source_track_key, canonical_track_id, source_id, external_id,
      title, artist, album, duration_ms, artwork_url, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 2000, NULL, ?, ?)
  `).run(
    userId,
    `${SOURCE_ID}:${input.externalId}`,
    input.canonicalId,
    SOURCE_ID,
    input.externalId,
    input.title,
    input.artist,
    now,
    now,
  )
}

mkdirSync(dataDir, { recursive: true })
mkdirSync(audioDir, { recursive: true })

// seed/atl длиннее — жест и двойной Next успевают до ended; остальные короткие.
const tones: Array<{ file: string; sec: number; hz: number }> = [
  { file: 'seed.wav', sec: 8.0, hz: 220 },
  { file: 'atl.wav', sec: 8.0, hz: 330 },
  { file: 'rec1.wav', sec: 2.5, hz: 440 },
  { file: 'rec2.wav', sec: 2.5, hz: 554 },
  { file: 'rec3.wav', sec: 2.5, hz: 659 },
  { file: 'kino1.wav', sec: 3.0, hz: 392 },
  { file: 'kino2.wav', sec: 3.0, hz: 415 },
  { file: 'zem1.wav', sec: 3.0, hz: 466 },
  { file: 'zem2.wav', sec: 3.0, hz: 494 },
  { file: 'bi2-1.wav', sec: 3.0, hz: 523 },
  { file: 'bi2-2.wav', sec: 3.0, hz: 587 },
  { file: 'mt1.wav', sec: 3.0, hz: 622 },
  { file: 'mt2.wav', sec: 3.0, hz: 698 },
  { file: 'ddt1.wav', sec: 3.0, hz: 740 },
  { file: 'ddt2.wav', sec: 3.0, hz: 784 },
  { file: 'nau1.wav', sec: 3.0, hz: 831 },
  { file: 'other1.wav', sec: 3.0, hz: 880 },
]
for (const tone of tones) {
  writeToneWav(join(audioDir, tone.file), tone.sec, tone.hz)
}

const work = createPasswordWorkLimiter(2)
const db = openDatabase(dbPath)
const existing = db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(EMAIL) as
  | { id: string; password_hash: string }
  | undefined

const forceRotate = process.argv.includes('--rotate-password')
const storedPassword = existsSync(passwordPath)
  ? readFileSync(passwordPath, 'utf8').trim()
  : ''
const storedIsAsciiAlnum = /^[A-Za-z0-9]+$/.test(storedPassword)
// Старые пароли с '-' / base64url + файл с \\n ломали ручной вход владельца.
const mustRotateForCharset = Boolean(storedPassword) && !storedIsAsciiAlnum

let password: string
let passwordHash: string
let passwordAction: 'kept' | 'created' | 'rotated'

if (
  existing &&
  storedPassword &&
  !forceRotate &&
  !mustRotateForCharset &&
  (await verifyPassword(storedPassword, existing.password_hash, work))
) {
  // Повторный prepare не должен менять рабочие credentials.
  password = storedPassword
  passwordHash = existing.password_hash
  passwordAction = 'kept'
} else {
  // Только ASCII letters+digits: без '-', base64url и перевода строки в файле.
  // Иначе Ctrl+A/Copy из PASSWORD.txt или автозаполнение дают ложный INVALID_CREDENTIALS.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  const bytes = randomBytes(20)
  password = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
  passwordHash = await hashPassword(password, work)
  passwordAction = existing ? 'rotated' : 'created'
}

let userId: string
if (existing) {
  userId = existing.id
  if (passwordAction !== 'kept') {
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(
      passwordHash,
      now,
      userId,
    )
  }
  db.prepare('DELETE FROM user_track_source_copies WHERE user_id = ?').run(userId)
  db.prepare('DELETE FROM user_canonical_library_tracks WHERE user_id = ?').run(userId)
  db.prepare('DELETE FROM user_canonical_tracks WHERE user_id = ?').run(userId)
} else {
  userId = randomUUID()
  db.prepare(`
    INSERT INTO users (id, first_name, last_name, email, password_hash, created_at, updated_at)
    VALUES (?, 'Dev', 'Acceptance', ?, ?, ?, ?)
  `).run(userId, EMAIL, passwordHash, now, now)
}

// Сильные лайки по трекам выдачи «Сплин» — без hard-exclude движок предпочёл бы их.
seedLiked(db, userId, {
  canonicalId: 'can_dev_seed',
  externalId: 'seed',
  title: 'Seed Song',
  artist: 'Сплин',
  lastPlayed: '2026-10-25T12:00:00.000Z',
  playCount: 20,
})
seedLiked(db, userId, {
  canonicalId: 'can_dev_atl',
  externalId: 'atl',
  title: 'ATL',
  artist: 'Сплин',
  lastPlayed: '2026-10-26T12:00:00.000Z',
  playCount: 18,
})
seedLiked(db, userId, {
  canonicalId: 'can_dev_rec1',
  externalId: 'rec-1',
  title: 'Recommendation 1',
  artist: 'Сплин',
  lastPlayed: '2026-10-27T12:00:00.000Z',
  playCount: 16,
})
seedLiked(db, userId, {
  canonicalId: 'can_dev_rec2',
  externalId: 'rec-2',
  title: 'Recommendation 2',
  artist: 'Сплин',
  lastPlayed: '2026-10-27T13:00:00.000Z',
  playCount: 15,
})
// Персональные предпочтения вне выдачи (fallback после hard-exclude поиска).
seedLiked(db, userId, {
  canonicalId: 'can_dev_kino',
  externalId: 'kino-blood',
  title: 'Группа крови',
  artist: 'Кино',
  lastPlayed: '2026-10-20T12:00:00.000Z',
  playCount: 12,
})
seedLiked(db, userId, {
  canonicalId: 'can_dev_zem',
  externalId: 'zem-iskala',
  title: 'Искала',
  artist: 'Земфира',
  lastPlayed: '2026-10-21T12:00:00.000Z',
  playCount: 10,
})
seedLiked(db, userId, {
  canonicalId: 'can_dev_bi2',
  externalId: 'bi2-polkovnik',
  title: 'Полковнику никто не пишет',
  artist: 'Би-2',
  lastPlayed: '2026-10-22T12:00:00.000Z',
  playCount: 9,
})
seedLiked(db, userId, {
  canonicalId: 'can_dev_mt',
  externalId: 'mt-vlad',
  title: 'Владивосток 2000',
  artist: 'Мумий Тролль',
  lastPlayed: '2026-10-23T12:00:00.000Z',
  playCount: 8,
})
seedLiked(db, userId, {
  canonicalId: 'can_dev_ddt',
  externalId: 'ddt-what',
  title: 'Что такое осень',
  artist: 'ДДТ',
  lastPlayed: '2026-10-24T12:00:00.000Z',
  playCount: 7,
})

// Без завершающего \\n: копирование «всего файла» иначе ломает verifyPassword.
writeFileSync(passwordPath, password, 'utf8')
writeFileSync(
  loginPath,
  [
    `email=${EMAIL}`,
    `password_file=${passwordPath}`,
    `database=${dbPath}`,
    `source=dev-acceptance`,
    `password_charset=ascii_alnum`,
    `password_file_trailing_newline=false`,
    `note=copy entire PASSWORD.txt; do not add spaces; disable browser password autofill for this site`,
    '',
  ].join('\n'),
  'utf8',
)

console.log('DEV acceptance prepared.')
console.log(`database=${dbPath}`)
console.log(`email=${EMAIL}`)
console.log(`password_file=${passwordPath}`)
console.log(`password_action=${passwordAction}`)
console.log(`audio_dir=${audioDir}`)
console.log('Note: WAV served only by Vite DEV middleware (not public/ → not in dist).')
console.log('Re-run keeps existing PASSWORD.txt + hash unless --rotate-password.')

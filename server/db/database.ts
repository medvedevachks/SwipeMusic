import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/**
 * Все серверные timestamp — ISO 8601 UTC (`YYYY-MM-DDTHH:mm:ss.sssZ`).
 * Новые таблицы добавляются здесь же: отдельной БД и ORM нет.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE IF NOT EXISTS user_categories (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  icon TEXT NOT NULL,
  color TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  favorite INTEGER NOT NULL,
  system INTEGER NOT NULL,
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_collection_tracks (
  user_id TEXT NOT NULL,
  track_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  album TEXT,
  genre TEXT,
  year INTEGER,
  duration_ms INTEGER,
  cover_url TEXT,
  cover_color TEXT,
  preview_url TEXT,
  tags_json TEXT NOT NULL,
  added_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_played TEXT,
  play_count INTEGER NOT NULL,
  liked INTEGER NOT NULL,
  liked_at TEXT,
  disliked INTEGER NOT NULL,
  skipped INTEGER NOT NULL,
  notes TEXT NOT NULL,
  favorite INTEGER NOT NULL,
  hidden INTEGER NOT NULL,
  custom_metadata_json TEXT NOT NULL,
  PRIMARY KEY (user_id, track_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_category_tracks (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  category_id TEXT NOT NULL,
  track_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, id),
  UNIQUE (user_id, category_id, track_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, category_id) REFERENCES user_categories (user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, track_id) REFERENCES user_collection_tracks (user_id, track_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_history (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  track_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  action TEXT NOT NULL,
  category_id TEXT,
  category_json TEXT,
  track_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT PRIMARY KEY,
  gesture_config_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_categories_sort
  ON user_categories (user_id, sort_order, created_at);
CREATE INDEX IF NOT EXISTS idx_user_history_created
  ON user_history (user_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_user_assignments_track
  ON user_category_tracks (user_id, track_id);
`

export function openDatabase(databasePath: string): DatabaseSync {
  if (databasePath !== ':memory:') {
    mkdirSync(dirname(databasePath), { recursive: true })
  }

  const db = new DatabaseSync(databasePath)
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(SCHEMA)
  return db
}

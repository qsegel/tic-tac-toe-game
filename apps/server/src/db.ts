import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * Открывает SQLite-базу и применяет миграции.
 *
 * `:memory:` используется тестами: у каждого приложения своя база.
 */
export function openDatabase(path: string): DatabaseSync {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  if (path !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
  }
  migrate(db);
  return db;
}

function migrate(db: DatabaseSync): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined;
  const version = Number(row?.user_version ?? 0);

  if (version < 1) {
    db.exec(`
      BEGIN;

      CREATE TABLE IF NOT EXISTS users (
        id            TEXT PRIMARY KEY,
        email         TEXT NOT NULL UNIQUE,
        name          TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at    INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS matches (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        game_id     TEXT NOT NULL,
        round       INTEGER NOT NULL,
        code        TEXT NOT NULL,
        status      TEXT NOT NULL,
        winner      TEXT,
        finished_at INTEGER NOT NULL,
        UNIQUE (game_id, round)
      );

      CREATE TABLE IF NOT EXISTS match_players (
        match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
        user_id  TEXT,
        name     TEXT NOT NULL,
        mark     TEXT NOT NULL,
        result   TEXT NOT NULL,
        PRIMARY KEY (match_id, mark)
      );

      CREATE INDEX IF NOT EXISTS idx_match_players_user ON match_players(user_id, match_id);
      CREATE INDEX IF NOT EXISTS idx_matches_finished ON matches(finished_at DESC);

      PRAGMA user_version = 1;

      COMMIT;
    `);
  }

  // v2: рейтинг Эло. Старые партии остаются нерейтинговыми (rated = 0).
  if (version < 2) {
    db.exec(`
      BEGIN;

      ALTER TABLE users ADD COLUMN rating INTEGER NOT NULL DEFAULT 1000;
      ALTER TABLE users ADD COLUMN best_rating INTEGER NOT NULL DEFAULT 1000;
      ALTER TABLE users ADD COLUMN rated_games INTEGER NOT NULL DEFAULT 0;

      ALTER TABLE matches ADD COLUMN rated INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_players ADD COLUMN rating_before INTEGER;
      ALTER TABLE match_players ADD COLUMN rating_after INTEGER;

      CREATE INDEX IF NOT EXISTS idx_users_rating ON users (rating DESC, rated_games DESC, created_at ASC);

      PRAGMA user_version = 2;

      COMMIT;
    `);
  }
}

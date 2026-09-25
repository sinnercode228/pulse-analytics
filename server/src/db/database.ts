import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * Built-in `node:sqlite` — no native addon to compile, works on any Node ≥ 22.13.
 * WAL mode lets the API process and the uptime worker share one file.
 */
export type Db = DatabaseSync;

const MIGRATIONS: readonly string[] = [
  `CREATE TABLE sites (
     id          TEXT PRIMARY KEY,
     name        TEXT NOT NULL,
     domain      TEXT NOT NULL,
     time_zone   TEXT NOT NULL DEFAULT 'UTC',
     created_at  INTEGER NOT NULL
   );
   CREATE TABLE rollups (
     site_id     TEXT NOT NULL,
     granularity TEXT NOT NULL,
     dimension   TEXT NOT NULL,
     bucket      INTEGER NOT NULL,
     value       TEXT NOT NULL,
     pageviews   INTEGER NOT NULL,
     visitors    BLOB NOT NULL,
     load_sum    REAL NOT NULL,
     load_count  INTEGER NOT NULL,
     PRIMARY KEY (site_id, granularity, dimension, bucket, value)
   ) WITHOUT ROWID;
   CREATE TABLE salts (
     day   INTEGER PRIMARY KEY,
     salt  TEXT NOT NULL
   );
   CREATE TABLE monitors (
     id                 TEXT PRIMARY KEY,
     name               TEXT NOT NULL,
     url                TEXT NOT NULL,
     method             TEXT NOT NULL DEFAULT 'GET',
     interval_sec       INTEGER NOT NULL,
     timeout_ms         INTEGER NOT NULL,
     degraded_after_ms  INTEGER NOT NULL,
     paused             INTEGER NOT NULL DEFAULT 0,
     created_at         INTEGER NOT NULL
   );
   CREATE TABLE checks (
     monitor_id  TEXT NOT NULL,
     ts          INTEGER NOT NULL,
     ok          INTEGER NOT NULL,
     status      INTEGER,
     latency_ms  INTEGER NOT NULL,
     error       TEXT,
     PRIMARY KEY (monitor_id, ts)
   ) WITHOUT ROWID;
   CREATE TABLE uptime_daily (
     monitor_id   TEXT NOT NULL,
     day          INTEGER NOT NULL,
     checks       INTEGER NOT NULL,
     failures     INTEGER NOT NULL,
     latency_sum  REAL NOT NULL,
     latency_max  INTEGER NOT NULL,
     PRIMARY KEY (monitor_id, day)
   ) WITHOUT ROWID;
   CREATE TABLE incidents (
     id           TEXT PRIMARY KEY,
     monitor_id   TEXT NOT NULL,
     started_at   INTEGER NOT NULL,
     resolved_at  INTEGER,
     cause        TEXT NOT NULL,
     failures     INTEGER NOT NULL
   );
   CREATE INDEX incidents_by_monitor ON incidents (monitor_id, started_at);`,
];

export function openDatabase(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

function migrate(db: Db): void {
  const { user_version: version } = db.prepare('PRAGMA user_version').get() as {
    user_version: number;
  };
  for (let v = version; v < MIGRATIONS.length; v++) {
    transaction(db, () => {
      db.exec(MIGRATIONS[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

export function transaction<T>(db: Db, fn: () => T): T {
  if (db.isTransaction) return fn();
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

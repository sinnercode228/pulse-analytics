import type { Config } from './config.js';
import type { AppContext } from './context.js';
import { openDatabase, type Db } from './db/database.js';
import { SqliteRollupRepository } from './db/rollup-repo.js';
import { SiteRegistry } from './db/sites-repo.js';
import { UptimeRepository } from './db/uptime-repo.js';
import { IngestPipeline } from './ingest/pipeline.js';
import { SaltStore } from './ingest/salt.js';
import { LiveHub } from './live/hub.js';
import { StatsService } from './stats/service.js';
import type { FetchLike } from './uptime/checker.js';
import { UptimeService } from './uptime/service.js';

export interface ContextOverrides {
  db?: Db;
  now?: () => number;
  fetch?: FetchLike;
}

export function createContext(config: Config, overrides: ContextOverrides = {}): AppContext {
  const now = overrides.now ?? Date.now;
  const db = overrides.db ?? openDatabase(config.databasePath);
  const sites = new SiteRegistry(db);
  const rollups = new SqliteRollupRepository(db);
  const uptimeRepo = new UptimeRepository(db);
  const hub = new LiveHub();
  const pipeline = new IngestPipeline({
    repo: rollups,
    hub,
    timeZone: sites.timeZone,
    flushIntervalMs: config.flushIntervalMs,
    now,
  });
  const stats = new StatsService(rollups, sites, pipeline, now);
  const uptime = new UptimeService({
    repo: uptimeRepo,
    hub,
    now,
    ...(overrides.fetch ? { fetch: overrides.fetch } : {}),
  });
  return {
    config,
    db,
    sites,
    rollups,
    uptimeRepo,
    salts: new SaltStore(db),
    hub,
    pipeline,
    stats,
    uptime,
    now,
  };
}

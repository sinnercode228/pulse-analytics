import type { Config } from './config.js';
import type { Db } from './db/database.js';
import type { SqliteRollupRepository } from './db/rollup-repo.js';
import type { SiteRegistry } from './db/sites-repo.js';
import type { UptimeRepository } from './db/uptime-repo.js';
import type { IngestPipeline } from './ingest/pipeline.js';
import type { SaltStore } from './ingest/salt.js';
import type { LiveHub } from './live/hub.js';
import type { StatsService } from './stats/service.js';
import type { UptimeService } from './uptime/service.js';

/** Everything route handlers need — built once in `createContext`. */
export interface AppContext {
  config: Config;
  db: Db;
  sites: SiteRegistry;
  rollups: SqliteRollupRepository;
  uptimeRepo: UptimeRepository;
  salts: SaltStore;
  hub: LiveHub;
  pipeline: IngestPipeline;
  stats: StatsService;
  uptime: UptimeService;
  now: () => number;
}

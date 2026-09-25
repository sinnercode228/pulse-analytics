export type UptimeMode = 'inline' | 'off';

export interface Config {
  host: string;
  port: number;
  /** SQLite file path, or `:memory:`. */
  databasePath: string;
  /** Bearer token for admin endpoints (create sites/monitors). Empty = admin API disabled. */
  adminToken: string;
  /** Comma-separated list of allowed dashboard origins, `*` for any. */
  corsOrigin: string;
  trustProxy: boolean;
  /** `inline` runs the uptime checker inside the API process; `off` expects `uptime-worker`. */
  uptimeMode: UptimeMode;
  flushIntervalMs: number;
  /** Optional directory with the built dashboard to serve at `/`. */
  staticDir: string;
  logLevel: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    host: env.HOST ?? '0.0.0.0',
    port: Number(env.PORT ?? 8787),
    databasePath: env.DATABASE_PATH ?? './data/pulse.db',
    adminToken: env.ADMIN_TOKEN ?? '',
    corsOrigin: env.CORS_ORIGIN ?? '*',
    trustProxy: env.TRUST_PROXY !== 'false',
    uptimeMode: env.UPTIME_MODE === 'off' ? 'off' : 'inline',
    flushIntervalMs: Number(env.FLUSH_INTERVAL_MS ?? 2000),
    staticDir: env.STATIC_DIR ?? '',
    logLevel: env.LOG_LEVEL ?? 'info',
  };
}

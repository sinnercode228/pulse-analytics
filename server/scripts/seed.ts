/**
 * Seeds a dev database with synthetic history (same generators as the
 * GitHub Pages demo): 3 fictional sites and 6 monitors.
 *   npm run seed -- --days 30
 */
import { DAY, HOUR, RollupBuilder, type Granularity, type PageviewEvent } from '@pulse/core';
import {
  MONITOR_PROFILES,
  MonitorSimulator,
  SITE_PROFILES,
  TrafficSimulator,
} from '@pulse/core/synth';
import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/db/database.js';
import { SqliteRollupRepository } from '../src/db/rollup-repo.js';
import { SiteRegistry } from '../src/db/sites-repo.js';
import { UptimeRepository } from '../src/db/uptime-repo.js';

const args = process.argv.slice(2);
const daysArg = args.indexOf('--days');
const days = daysArg >= 0 ? Number(args[daysArg + 1]) : 30;
const now = Date.now();
const config = loadConfig();
const db = openDatabase(config.databasePath);
const sites = new SiteRegistry(db);
const rollups = new SqliteRollupRepository(db);
const uptime = new UptimeRepository(db);

console.log(`Seeding ${config.databasePath} with ${days} days of synthetic data…`);
db.exec(
  'DELETE FROM rollups; DELETE FROM checks; DELETE FROM uptime_daily; DELETE FROM incidents;',
);

for (const profile of SITE_PROFILES) {
  sites.upsert({ id: profile.id, name: profile.name, domain: profile.domain, timeZone: 'UTC' });
  const tiers = (e: PageviewEvent): Granularity[] =>
    now - e.ts < rollups.retention.minute
      ? ['minute', 'hour', 'day']
      : now - e.ts < rollups.retention.hour
        ? ['hour', 'day']
        : ['day'];
  const builder = new RollupBuilder({ granularities: tiers });
  const sim = new TrafficSimulator({ profile, start: now - days * DAY, anchor: now });
  let n = 0;
  for (let t = now - days * DAY; t < now; t += 6 * HOUR) {
    sim.advance(Math.min(t + 6 * HOUR, now), (e) => {
      builder.add(e);
      n++;
    });
    if (builder.size > 20_000) rollups.upsert(builder.drain());
  }
  rollups.upsert(builder.drain());
  console.log(`  ${profile.name}: ${n.toLocaleString('en')} pageviews`);
}

for (const profile of MONITOR_PROFILES) {
  const { baseLatencyMs: _b, jitter: _j, blipRate: _r, incidents: _i, ...monitor } = profile;
  // Fictional endpoints: keep the history, pause live probing.
  uptime.upsertMonitor(monitor, true);
  const sim = new MonitorSimulator(profile, now, now - Math.min(days, 90) * DAY);
  sim.advance(now);
  for (const d of sim.daily.values()) uptime.writeDaily(profile.id, d);
  for (const i of sim.incidents) uptime.writeIncident(i);
  uptime.insertChecks(sim.recent);
}

const port = config.port;
uptime.upsertMonitor({
  id: 'pulse-self',
  name: 'Pulse API (self-check)',
  url: process.env.SELF_CHECK_URL ?? `http://127.0.0.1:${port}/api/health`,
  method: 'GET',
  intervalSec: 60,
  timeoutMs: 5_000,
  degradedAfterMs: 300,
});

console.log(`Done: ${rollups.count().toLocaleString('en')} rollup rows.`);
db.close();

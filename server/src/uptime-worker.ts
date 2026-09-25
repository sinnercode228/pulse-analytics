/**
 * Standalone uptime checker. Shares the SQLite file with the API (WAL mode),
 * so probes keep running while the API scales or restarts.
 * Usage: UPTIME_MODE=off for the API + `node dist/uptime-worker.js`.
 */
import { loadConfig } from './config.js';
import { openDatabase } from './db/database.js';
import { UptimeRepository } from './db/uptime-repo.js';
import { UptimeService } from './uptime/service.js';

const config = loadConfig();
const db = openDatabase(config.databasePath);
const service = new UptimeService({
  repo: new UptimeRepository(db),
  log: (msg) => console.error(msg),
});

service.start();
console.log(
  `[uptime-worker] checking ${new UptimeRepository(db).listMonitors().filter((m) => !m.paused).length} monitors`,
);

// Pick up monitors added through the admin API.
setInterval(() => service.start(), 5 * 60 * 1000);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    service.stop();
    db.close();
    process.exit(0);
  });
}

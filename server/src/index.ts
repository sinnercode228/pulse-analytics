import { HOUR } from '@pulse/core';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createContext } from './create-context.js';

const config = loadConfig();
const ctx = createContext(config);
const app = await buildApp(ctx, { logger: true });

ctx.pipeline.start();
if (config.uptimeMode === 'inline') ctx.uptime.start();
const pruner = setInterval(() => ctx.rollups.prune(Date.now()), HOUR);
pruner.unref();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info(`${signal} received, flushing and shutting down`);
    void app.close().then(() => {
      ctx.db.close();
      process.exit(0);
    });
  });
}

await app.listen({ host: config.host, port: config.port });

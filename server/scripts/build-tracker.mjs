import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TRACKER_BUDGET_BYTES, bundleTracker } from '../tracker/bundle.ts';

const { code, bytes, gzipBytes } = await bundleTracker();
if (bytes > TRACKER_BUDGET_BYTES) {
  console.error(`tracker is ${bytes} B — over the ${TRACKER_BUDGET_BYTES} B budget`);
  process.exit(1);
}
mkdirSync(fileURLToPath(new URL('../public/', import.meta.url)), { recursive: true });
writeFileSync(fileURLToPath(new URL('../public/p.js', import.meta.url)), code);
console.log(`tracker: ${bytes} B minified, ${gzipBytes} B gzipped`);

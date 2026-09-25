import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

// Bundle the workspace package (@pulse/core ships TypeScript sources), keep npm deps external.
await build({
  entryPoints: ['src/index.ts', 'src/uptime-worker.ts', 'scripts/seed.ts'].map((p) =>
    fileURLToPath(new URL(`../${p}`, import.meta.url)),
  ),
  outdir: fileURLToPath(new URL('../dist', import.meta.url)),
  // flatten scripts/seed.ts → dist/seed.js
  entryNames: '[name]',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  external: Object.keys(pkg.dependencies ?? {}),
  logLevel: 'info',
});

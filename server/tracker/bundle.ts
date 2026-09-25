import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

/** Hard budget for the minified tracker, enforced by the build and by a test. */
export const TRACKER_BUDGET_BYTES = 2048;

export interface TrackerBundle {
  code: string;
  bytes: number;
  gzipBytes: number;
}

export async function bundleTracker(): Promise<TrackerBundle> {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('./tracker.ts', import.meta.url))],
    bundle: true,
    minify: true,
    format: 'iife',
    target: ['es2019'],
    legalComments: 'none',
    write: false,
  });
  const code = result.outputFiles[0]!.text;
  return { code, bytes: Buffer.byteLength(code), gzipBytes: gzipSync(code).length };
}

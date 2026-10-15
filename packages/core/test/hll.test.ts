import { describe, expect, it } from 'vitest';
import { Hll, HLL_PRECISION, hash32 } from '../src/index.js';
import stored from './fixtures/stored-sketches.json';

const ids = (n: number, prefix = 'v') => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

/** 1.04 / √m, the textbook standard error at this precision (2.3%). */
const STANDARD_ERROR = 1.04 / Math.sqrt(1 << HLL_PRECISION);
const SEED = 2013;

/** mulberry32: uniform 32-bit hashes, the same sequence on every run for a given seed. */
function hashStream(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
}

/** Registers of a dense sketch or the sorted hashes of a sparse one. */
function canonical(h: Hll): string {
  const bytes = h.toBytes();
  if (!h.isSparse) return bytes.join(',');
  const view = new DataView(bytes.buffer);
  const hashes: number[] = [];
  for (let offset = 1; offset < bytes.length; offset += 4)
    hashes.push(view.getUint32(offset, true));
  return `sparse:${hashes.sort((a, b) => a - b).join(',')}`;
}

const fromHex = (hex: string) => Uint8Array.from(hex.match(/../g)!, (byte) => parseInt(byte, 16));

describe('hash32', () => {
  it('is deterministic and seed-sensitive', () => {
    expect(hash32('visitor-1')).toBe(hash32('visitor-1'));
    expect(hash32('visitor-1')).not.toBe(hash32('visitor-2'));
    expect(hash32('visitor-1', 1)).not.toBe(hash32('visitor-1', 2));
    expect(hash32('')).toBe(0);
  });

  it('spreads keys evenly across the top bits', () => {
    const buckets = new Array<number>(16).fill(0);
    for (const id of ids(16_000)) buckets[hash32(id) >>> 28]! += 1;
    for (const b of buckets) expect(Math.abs(b - 1000)).toBeLessThan(150);
  });
});

describe('Hll', () => {
  it('is exact while sparse', () => {
    const h = Hll.from([...ids(300), ...ids(300)]);
    expect(h.isSparse).toBe(true);
    expect(h.count()).toBe(300);
  });

  it('is exact at 512 distinct hashes and switches to dense registers at 513', () => {
    const values = ids(513, 'edge');
    expect(new Set(values.map((v) => hash32(v))).size).toBe(513);
    const h = Hll.from(values.slice(0, 512));
    expect(h.isSparse).toBe(true);
    expect(h.count()).toBe(512);
    expect(h.toBytes().length).toBe(1 + 512 * 4);
    h.addString(values[512]!);
    expect(h.isSparse).toBe(false);
    expect(h.toBytes().length).toBe((1 << HLL_PRECISION) + 1);
    expect(Math.abs(h.count() - 513) / 513).toBeLessThan(0.05);
  });

  it('switches to dense registers and stays within 3% at 100k', () => {
    const h = Hll.from(ids(100_000));
    expect(h.isSparse).toBe(false);
    expect(Math.abs(h.count() - 100_000) / 100_000).toBeLessThan(0.03);
  });

  it.each([1_000, 5_000, 20_000])('estimates %i distinct values within 5%%', (n) => {
    const estimate = Hll.from(ids(n, `set${n}-`)).count();
    expect(Math.abs(estimate - n) / n).toBeLessThan(0.05);
  });

  it('merges as a set union (overlapping visitors are not double counted)', () => {
    const a = Hll.from(ids(4_000));
    const b = Hll.from(ids(4_000).map((_, i) => `v${i + 2_000}`));
    const union = a.clone().merge(b).count();
    expect(Math.abs(union - 6_000) / 6_000).toBeLessThan(0.04);
    expect(a.count()).toBeLessThan(union);
  });

  it('merge is commutative across sparse/dense modes', () => {
    const small = Hll.from(ids(50, 's'));
    const big = Hll.from(ids(10_000, 'b'));
    expect(small.clone().merge(big).count()).toBe(big.clone().merge(small).count());
  });

  it('round-trips through bytes in both modes', () => {
    const sparse = Hll.from(ids(10));
    const dense = Hll.from(ids(9_000));
    expect(Hll.fromBytes(sparse.toBytes()).count()).toBe(10);
    expect(Hll.fromBytes(dense.toBytes()).count()).toBe(dense.count());
    expect(dense.toBytes().length).toBe((1 << HLL_PRECISION) + 1);
    expect(Hll.fromBytes(new Uint8Array()).count()).toBe(0);
  });

  it('rejects corrupted payloads', () => {
    expect(() => Hll.fromBytes(new Uint8Array([1, 2, 3]))).toThrow(RangeError);
    expect(() => Hll.fromBytes(new Uint8Array([0, 1, 2]))).toThrow(RangeError);
  });

  it('decodes sketches stored before the bias correction and writes the same bytes', () => {
    for (const { ids: n, hex } of [stored.sparse, stored.dense]) {
      const bytes = fromHex(hex);
      const fresh = Hll.from(ids(n, 'stored-'));
      const decoded = Hll.fromBytes(bytes);
      expect(fresh.toBytes()).toEqual(bytes);
      expect(decoded.toBytes()).toEqual(bytes);
      expect(decoded.count()).toBe(fresh.count());
    }
    expect(Hll.fromBytes(fromHex(stored.sparse.hex)).count()).toBe(20);
    const merged = Hll.fromBytes(fromHex(stored.dense.hex)).merge(Hll.from(ids(6_000, 'stored-')));
    expect(canonical(merged)).toBe(canonical(Hll.from(ids(6_000, 'stored-'))));
  });

  it('merges associatively and commutatively across sparse and dense sketches', () => {
    const inputs = [
      ids(200, 'a'), // sparse
      ids(250, 'b'), // sparse, still sparse when merged with the first
      ids(300, 'a'), // sparse, overlaps the first; all three together are dense
      ids(4_000, 'd'), // dense
    ];
    const sketch = (i: number) => Hll.from(inputs[i]!);
    const union = (...picked: number[]) => Hll.from(picked.flatMap((i) => inputs[i]!));
    for (let x = 0; x < inputs.length; x++) {
      for (let y = 0; y < inputs.length; y++) {
        expect(canonical(sketch(x).merge(sketch(y)))).toBe(canonical(union(x, y)));
        for (let z = 0; z < inputs.length; z++) {
          const left = sketch(x).merge(sketch(y)).merge(sketch(z));
          const right = sketch(x).merge(sketch(y).merge(sketch(z)));
          expect(canonical(left)).toBe(canonical(right));
          expect(canonical(left)).toBe(canonical(union(x, y, z)));
          expect(left.count()).toBe(sketch(z).merge(sketch(y)).merge(sketch(x)).count());
        }
      }
    }
    expect(union(0, 1).isSparse).toBe(true);
    expect(union(0, 1, 2).isSparse).toBe(false);
  });
});

describe('Hll accuracy (seeded hash streams)', () => {
  it('is exact up to 512 and within 3% rms and 1% mean error from 513 to 200,000', () => {
    const sizes = [
      1, 2, 10, 100, 512, 513, 1_000, 1_500, 1_800, 2_000, 3_000, 4_000, 5_000, 6_000, 7_000, 8_000,
      10_000, 12_000, 20_000, 50_000, 100_000, 200_000,
    ];
    const trials = 100;
    const next = hashStream(SEED);
    const errors = sizes.map(() => [] as number[]);
    for (let t = 0; t < trials; t++) {
      const h = new Hll();
      let n = 0;
      sizes.forEach((size, s) => {
        for (; n < size; n++) h.addHash(next());
        errors[s]!.push((h.count() - size) / size);
      });
    }
    const outOfBound = sizes.flatMap((n, s) => {
      const e = errors[s]!;
      const rms = Math.sqrt(e.reduce((acc, x) => acc + x * x, 0) / trials);
      const mean = e.reduce((acc, x) => acc + x, 0) / trials;
      const ok = n <= 512 ? e.every((x) => x === 0) : rms < 0.03 && Math.abs(mean) < 0.01;
      return ok ? [] : [{ n, rms: rms.toFixed(4), mean: mean.toFixed(4) }];
    });
    expect(outOfBound).toEqual([]);
  });

  it('does not jump where one estimator hands over to another', () => {
    // Linear counting hands over near 1,800 and the bias table ends at a raw estimate of
    // 5·m = 10,240; before the correction, the raw estimate took over near 5,120.
    const every = 5;
    const windows = [1_600, 4_600, 9_800].map((lo) =>
      Array.from({ length: 201 }, (_, i) => lo + i * every),
    );
    const trials = 100;
    const next = hashStream(SEED);
    const sums = windows.map((points) => points.map(() => 0));
    let largestChange = 0;
    for (let t = 0; t < trials; t++) {
      const h = new Hll();
      let n = 0;
      windows.forEach((points, w) => {
        let previous: number | undefined;
        points.forEach((point, i) => {
          for (; n < point; n++) h.addHash(next());
          const count = h.count();
          if (previous !== undefined) {
            largestChange = Math.max(largestChange, Math.abs(count - previous) / point);
          }
          previous = count;
          sums[w]![i]! += count;
        });
      });
    }
    const worstMeanError = Math.max(
      ...windows.flatMap((points, w) =>
        points.map((point, i) => Math.abs(sums[w]![i]! / trials / point - 1)),
      ),
    );
    // A systematic jump would push the mean of 100 sketches off n after the handover.
    expect(worstMeanError).toBeLessThan(0.01);
    // At a handover one sketch still switches between two estimates of about the same n, so
    // it can step, but by less than two standard errors per 5 added hashes.
    expect(largestChange).toBeLessThan(2 * STANDARD_ERROR);
  });
});

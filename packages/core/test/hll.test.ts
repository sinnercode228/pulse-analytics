import { describe, expect, it } from 'vitest';
import { Hll, HLL_PRECISION, hash32 } from '../src/index.js';

const ids = (n: number, prefix = 'v') => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

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
});

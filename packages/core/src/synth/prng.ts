import { fmix32 } from '../hash.js';

/** Small, fast, seedable PRNG (mulberry32). Deterministic demos are testable demos. */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0 || 0x9e3779b9;
  }

  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)]!;
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  normal(): number {
    const u = 1 - this.next();
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  logNormal(median: number, sigma: number): number {
    return median * Math.exp(sigma * this.normal());
  }

  exponential(mean: number): number {
    return -mean * Math.log(1 - this.next());
  }

  poisson(lambda: number): number {
    if (lambda <= 0) return 0;
    if (lambda > 30) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * this.normal()));
    const limit = Math.exp(-lambda);
    let k = 0;
    let p = this.next();
    while (p > limit) {
      k++;
      p *= this.next();
    }
    return k;
  }
}

/** Uniform [0,1) derived from integers — stable noise that doesn't consume RNG state. */
export function hashUnit(...parts: number[]): number {
  let h = 0x811c9dc5;
  for (const p of parts) h = fmix32(h ^ (p | 0));
  return h / 4294967296;
}

/** Standard-normal sample derived from integers (Box–Muller over two hashes). */
export function hashNormal(...parts: number[]): number {
  const u = 1 - hashUnit(...parts, 1);
  const v = hashUnit(...parts, 2);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** O(log n) sampling from a fixed weighted list. */
export class WeightedTable<T> {
  private readonly items: T[];
  private readonly cumulative: Float64Array;
  readonly total: number;

  constructor(entries: readonly (readonly [T, number])[]) {
    this.items = entries.map(([item]) => item);
    this.cumulative = new Float64Array(entries.length);
    let acc = 0;
    entries.forEach(([, w], i) => {
      acc += Math.max(0, w);
      this.cumulative[i] = acc;
    });
    this.total = acc;
    if (acc <= 0) throw new RangeError('WeightedTable needs a positive total weight');
  }

  sample(rng: Rng): T {
    const target = rng.next() * this.total;
    let lo = 0;
    let hi = this.cumulative.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.cumulative[mid]! <= target) lo = mid + 1;
      else hi = mid;
    }
    return this.items[lo]!;
  }
}

/** Zipf-like weights: a few head pages and a long tail, like real sites. */
export function zipf<T>(items: readonly T[], exponent = 1.07): [T, number][] {
  return items.map((item, i) => [item, 1 / (i + 1) ** exponent]);
}

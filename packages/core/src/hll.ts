import { hash32 } from './hash.js';

/** Register index bits. 2^11 registers → ~2.3% standard error, 2 KiB dense. */
export const HLL_PRECISION = 11;
const M = 1 << HLL_PRECISION;
/** Sparse sets switch to dense registers once they would be larger than them. */
const SPARSE_MAX = M / 4;
const ALPHA = 0.7213 / (1 + 1.079 / M);
const MAX_RANK = 32 - HLL_PRECISION + 1;
const POW2_NEG = Float64Array.from({ length: MAX_RANK + 1 }, (_, r) => 2 ** -r);

const TAG_SPARSE = 0;
const TAG_DENSE = 1;

/**
 * HyperLogLog with an exact sparse mode (HLL++ style).
 *
 * Rollup rows for small buckets (one page, one hour) usually hold a handful of
 * visitors, so they stay exact and tiny. Large buckets upgrade to 2 KiB dense
 * registers. Sketches are mergeable, which is what lets us store per-bucket
 * rollups and still answer "unique visitors" for any range — the same idea as
 * ClickHouse's `uniqState` / `uniqMerge`.
 */
export class Hll {
  private sparse: Set<number> | null = new Set();
  private registers: Uint8Array | null = null;

  static from(values: Iterable<string>): Hll {
    const h = new Hll();
    for (const v of values) h.addString(v);
    return h;
  }

  get isSparse(): boolean {
    return this.sparse !== null;
  }

  addString(value: string): this {
    return this.addHash(hash32(value));
  }

  addHash(hash: number): this {
    const h = hash >>> 0;
    if (this.sparse) {
      this.sparse.add(h);
      if (this.sparse.size > SPARSE_MAX) this.toDense();
    } else {
      applyHash(this.registers!, h);
    }
    return this;
  }

  merge(other: Hll): this {
    if (other.sparse) {
      for (const h of other.sparse) this.addHash(h);
      return this;
    }
    if (this.sparse) this.toDense();
    const a = this.registers!;
    const b = other.registers!;
    for (let i = 0; i < M; i++) if (b[i]! > a[i]!) a[i] = b[i]!;
    return this;
  }

  count(): number {
    if (this.sparse) return this.sparse.size;
    const regs = this.registers!;
    let sum = 0;
    let zeros = 0;
    for (let i = 0; i < M; i++) {
      const r = regs[i]!;
      sum += POW2_NEG[r]!;
      if (r === 0) zeros++;
    }
    let estimate = (ALPHA * M * M) / sum;
    if (estimate <= 2.5 * M && zeros > 0) estimate = M * Math.log(M / zeros);
    return Math.round(estimate);
  }

  clone(): Hll {
    const copy = new Hll();
    if (this.sparse) copy.sparse = new Set(this.sparse);
    else {
      copy.sparse = null;
      copy.registers = this.registers!.slice();
    }
    return copy;
  }

  /** Compact binary form: `[0, u32le...]` (sparse) or `[1, registers...]` (dense). */
  toBytes(): Uint8Array {
    if (this.sparse) {
      const out = new Uint8Array(1 + this.sparse.size * 4);
      const view = new DataView(out.buffer);
      out[0] = TAG_SPARSE;
      let offset = 1;
      for (const h of this.sparse) {
        view.setUint32(offset, h, true);
        offset += 4;
      }
      return out;
    }
    const out = new Uint8Array(1 + M);
    out[0] = TAG_DENSE;
    out.set(this.registers!, 1);
    return out;
  }

  static fromBytes(bytes: Uint8Array): Hll {
    const h = new Hll();
    if (bytes.length === 0) return h;
    if (bytes[0] === TAG_DENSE) {
      if (bytes.length !== M + 1) throw new RangeError('Invalid dense HLL payload');
      h.sparse = null;
      h.registers = bytes.slice(1);
      return h;
    }
    if (bytes[0] !== TAG_SPARSE || (bytes.length - 1) % 4 !== 0) {
      throw new RangeError('Invalid sparse HLL payload');
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let offset = 1; offset < bytes.length; offset += 4)
      h.addHash(view.getUint32(offset, true));
    return h;
  }

  private toDense(): void {
    const regs = new Uint8Array(M);
    for (const h of this.sparse!) applyHash(regs, h);
    this.registers = regs;
    this.sparse = null;
  }
}

function applyHash(registers: Uint8Array, hash: number): void {
  const index = hash >>> (32 - HLL_PRECISION);
  const rest = (hash << HLL_PRECISION) >>> 0;
  const rank = rest === 0 ? MAX_RANK : Math.clz32(rest) + 1;
  if (rank > registers[index]!) registers[index] = rank;
}

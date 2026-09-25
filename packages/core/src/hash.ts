/**
 * MurmurHash3 (x86, 32-bit) over UTF-16 code units.
 * Deterministic across Node and browsers, which lets the server and the
 * in-browser demo produce byte-identical sketches for the same input.
 */
export function hash32(input: string, seed = 0): number {
  let h = seed >>> 0;
  const len = input.length;
  let i = 0;
  for (; i + 1 < len; i += 2) {
    let k = (input.charCodeAt(i) | (input.charCodeAt(i + 1) << 16)) >>> 0;
    k = Math.imul(k, 0xcc9e2d51);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, 0x1b873593);
    h ^= k;
    h = (h << 13) | (h >>> 19);
    h = (Math.imul(h, 5) + 0xe6546b64) | 0;
  }
  if (i < len) {
    let k = input.charCodeAt(i);
    k = Math.imul(k, 0xcc9e2d51);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, 0x1b873593);
    h ^= k;
  }
  h ^= len;
  return fmix32(h);
}

/** Murmur3 finalizer: good avalanche for integer keys. */
export function fmix32(value: number): number {
  let h = value | 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

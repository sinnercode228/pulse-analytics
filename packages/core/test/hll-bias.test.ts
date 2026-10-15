import { describe, expect, it } from 'vitest';
import { BIASES, LINEAR_COUNTING_THRESHOLD, RAW_ESTIMATES, estimateBias } from '../src/hll-bias.js';

describe('HLL++ bias table (p = 11)', () => {
  it('pairs each mean raw estimate with its bias at cardinalities from 1 to 5·m', () => {
    expect(RAW_ESTIMATES).toHaveLength(201);
    expect(BIASES).toHaveLength(201);
    const cardinalities = RAW_ESTIMATES.map((raw, i) => raw - BIASES[i]!);
    expect(cardinalities[0]).toBeCloseTo(1, 6);
    expect(cardinalities[200]).toBeCloseTo(5 * 2048, 6);
    for (let i = 1; i < RAW_ESTIMATES.length; i++) {
      expect(RAW_ESTIMATES[i]!).toBeGreaterThan(RAW_ESTIMATES[i - 1]!);
      expect(Math.round(cardinalities[i]! - cardinalities[i - 1]!)).toBeOneOf([51, 52]);
    }
    expect(LINEAR_COUNTING_THRESHOLD).toBe(1800);
  });

  it('averages the bias of the 6 nearest table points', () => {
    const nearestSix = (raw: number) =>
      RAW_ESTIMATES.map((point, i) => ({ distance: Math.abs(point - raw), bias: BIASES[i]! }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 6)
        .reduce((sum, p) => sum + p.bias / 6, 0);
    const probes = [1_000, 20_000, ...RAW_ESTIMATES];
    for (let raw = 1_400; raw < 10_400; raw += 13.7) probes.push(raw);
    for (const raw of probes) expect(estimateBias(raw)).toBeCloseTo(nearestSix(raw), 9);
  });
});

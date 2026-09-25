import { DAY, HOUR } from '../time.js';
import type { Device, PageviewEvent } from '../types.js';
import { MinHeap } from './heap.js';
import { BROWSERS, type SiteProfile } from './profiles.js';
import { Rng, WeightedTable, hashNormal, zipf } from './prng.js';

const VISITOR_POOL = 40_000;
const MAX_PAGES_PER_SESSION = 30;

export interface TrafficOptions {
  profile: SiteProfile;
  /** Simulation start (epoch ms). */
  start: number;
  /** Reference "now" that spikes and growth are anchored to. */
  anchor: number;
  seed?: number;
}

function diurnalCurve(localHour: number, work: number, evening: number): number {
  const w = Math.exp(-((localHour - 13) ** 2) / 14);
  const e = Math.exp(-((localHour - 20.5) ** 2) / 6);
  return 0.12 + work * w + evening * e;
}

/**
 * Generates realistic, deterministic pageview streams: weekly & daily
 * seasonality per country time zone, Zipf-distributed pages, returning
 * visitors, multi-page sessions, traffic spikes from launches/newsletters and
 * log-normal page-load times. The same instance backfills history and then
 * keeps producing "live" events, so the two always line up.
 */
export class TrafficSimulator {
  private readonly rng: Rng;
  private readonly seed: number;
  private readonly profile: SiteProfile;
  private readonly anchor: number;
  private cursor: number;
  private readonly pending = new MinHeap<PageviewEvent>((e) => e.ts);
  private readonly pool: string[] = [];
  private visitorSeq = 0;

  private readonly hourFactor: Float64Array;
  private readonly countryByUtcHour: WeightedTable<number>[];
  private readonly referrers: WeightedTable<string>;
  private readonly entries: WeightedTable<string>;
  private readonly pages: WeightedTable<string>;
  private readonly devices: WeightedTable<Device>;
  private readonly browsers: Record<Device, WeightedTable<string>>;
  private readonly weekdayNorm: number[];

  constructor(opts: TrafficOptions) {
    this.profile = opts.profile;
    this.seed = opts.seed ?? 42;
    this.rng = new Rng(this.seed);
    this.cursor = opts.start;
    this.anchor = opts.anchor;
    const p = this.profile;

    const [work, evening] = p.diurnal;
    const curve = (h: number) => diurnalCurve(((h % 24) + 24) % 24, work, evening);
    const mean = Array.from({ length: 24 }, (_, h) => curve(h)).reduce((a, b) => a + b, 0) / 24;
    const shareTotal = p.countries.reduce((s, c) => s + c[1], 0);
    this.hourFactor = new Float64Array(24);
    this.countryByUtcHour = [];
    for (let h = 0; h < 24; h++) {
      const weights = p.countries.map(
        ([, share, offset], i) => [i, (share / shareTotal) * (curve(h + offset) / mean)] as const,
      );
      this.hourFactor[h] = weights.reduce((s, [, w]) => s + w, 0);
      this.countryByUtcHour.push(new WeightedTable(weights));
    }
    const wdMean = p.weekday.reduce((a, b) => a + b, 0) / 7;
    this.weekdayNorm = p.weekday.map((w) => w / wdMean);

    this.referrers = new WeightedTable(p.referrers);
    this.pages = new WeightedTable(zipf(p.pages));
    this.entries = new WeightedTable([
      ...zipf(p.pages).map(([page, w]) => [page, w * 0.6] as const),
      ...p.entryBias.map((page) => [page, 0.5] as const),
    ]);
    this.devices = new WeightedTable(p.devices);
    this.browsers = {
      desktop: new WeightedTable(BROWSERS.desktop),
      mobile: new WeightedTable(BROWSERS.mobile),
      tablet: new WeightedTable(BROWSERS.tablet),
    };
  }

  get now(): number {
    return this.cursor;
  }

  /** Expected sessions per hour at instant `t` (before Poisson noise). */
  sessionsPerHour(t: number): number {
    const p = this.profile;
    const day = Math.floor(t / DAY);
    const utcHour = Math.floor(t / HOUR) % 24;
    const weekday = this.weekdayNorm[new Date(t).getUTCDay()]!;
    const growth = Math.max(0.3, 1 + p.growthPerDay * ((t - this.anchor) / DAY));
    const dayNoise = Math.exp(0.09 * hashNormal(this.seed, day));
    const sessionsPerVisitor = 1 + p.returningRate * 0.6;
    const base = (p.dailyVisitors * sessionsPerVisitor) / 24;
    return (
      base * weekday * growth * dayNoise * this.hourFactor[utcHour]! * (1 + this.spikeBoost(t))
    );
  }

  /**
   * Advance simulated time to `to`, emitting every pageview with `ts < to`
   * in chronological order.
   */
  advance(to: number, emit: (event: PageviewEvent) => void): void {
    while (this.cursor < to) {
      const stepEnd = Math.min(to, Math.floor(this.cursor / HOUR) * HOUR + HOUR);
      const span = stepEnd - this.cursor;
      const sessions = this.rng.poisson(
        (this.sessionsPerHour(this.cursor + span / 2) * span) / HOUR,
      );
      for (let i = 0; i < sessions; i++) this.spawnSession(this.cursor + this.rng.next() * span);
      this.cursor = stepEnd;
      while (this.pending.size > 0 && this.pending.peek()!.ts < stepEnd) emit(this.pending.pop()!);
    }
  }

  private spikeBoost(t: number): number {
    let boost = 0;
    for (const s of this.profile.spikes) {
      const start = this.anchor - s.daysAgo * DAY;
      if (t < start) continue;
      const hours = (t - start) / HOUR;
      if (hours > s.decayHours * 6) continue;
      const ramp = Math.min(1, hours / 1.5);
      boost += (s.multiplier - 1) * ramp * Math.exp(-hours / s.decayHours);
    }
    return boost;
  }

  private activeSpikeShare(
    t: number,
  ): { referrer: string; page: string | undefined; share: number } | null {
    const total = this.spikeBoost(t);
    if (total <= 0.02) return null;
    for (const s of this.profile.spikes) {
      const start = this.anchor - s.daysAgo * DAY;
      const hours = (t - start) / HOUR;
      if (hours >= 0 && hours <= s.decayHours * 6)
        return { referrer: s.referrer, page: s.page, share: total / (1 + total) };
    }
    return null;
  }

  private visitorId(): string {
    const rng = this.rng;
    if (this.pool.length > 50 && rng.chance(this.profile.returningRate)) {
      // Recent visitors are more likely to come back than old ones.
      const back = Math.floor(rng.exponential(this.pool.length / 6)) % this.pool.length;
      return this.pool[this.pool.length - 1 - back]!;
    }
    const id = `${this.profile.id}:${this.seed}:${this.visitorSeq++}`;
    if (this.pool.length >= VISITOR_POOL) this.pool.splice(0, VISITOR_POOL / 4);
    this.pool.push(id);
    return id;
  }

  private spawnSession(start: number): void {
    const { rng, profile } = this;
    const utcHour = Math.floor(start / HOUR) % 24;
    const countryIdx = this.countryByUtcHour[utcHour]!.sample(rng);
    const [country, , , loadFactor] = profile.countries[countryIdx]!;
    const device = this.devices.sample(rng);
    const browser = this.browsers[device].sample(rng);
    const visitorId = this.visitorId();

    let referrer = this.referrers.sample(rng);
    let entry = this.entries.sample(rng);
    const spike = this.activeSpikeShare(start);
    if (spike && rng.chance(spike.share)) {
      referrer = spike.referrer;
      if (spike.page) entry = spike.page;
    }

    const pagesInSession = Math.min(
      MAX_PAGES_PER_SESSION,
      1 + Math.floor(rng.exponential(profile.pagesPerVisit - 1)),
    );
    const deviceFactor = device === 'mobile' ? 1.55 : device === 'tablet' ? 1.25 : 1;
    let t = start;
    for (let i = 0; i < pagesInSession; i++) {
      const path = i === 0 ? entry : this.pages.sample(rng);
      this.pending.push({
        siteId: profile.id,
        ts: Math.round(t),
        visitorId,
        path,
        referrer,
        country,
        device,
        browser,
        loadMs:
          i === 0
            ? Math.round(rng.logNormal(profile.baseLoadMs * deviceFactor * loadFactor, 0.42))
            : undefined,
      });
      t += 4_000 + rng.exponential(55_000);
    }
  }
}

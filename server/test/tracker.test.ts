import { runInNewContext } from 'node:vm';
import { beforeAll, describe, expect, it } from 'vitest';
import { TRACKER_BUDGET_BYTES, bundleTracker, type TrackerBundle } from '../tracker/bundle.js';
import { toCsv } from '../src/stats/csv.js';

let bundle: TrackerBundle;
beforeAll(async () => {
  bundle = await bundleTracker();
});

function sandbox(opts: { site?: string; readyState?: string; ignore?: boolean } = {}) {
  const beacons: { url: string; body: Record<string, unknown> }[] = [];
  const listeners: Record<string, (() => void)[]> = {};
  const location = { href: 'https://demo.example/' };
  const history = { pushState() {}, replaceState() {} };
  const window = {
    innerWidth: 1280,
    localStorage: { getItem: (k: string) => (opts.ignore && k === 'pulse_ignore' ? '1' : null) },
    addEventListener: (type: string, fn: () => void) => (listeners[type] ??= []).push(fn),
  } as Record<string, unknown>;
  const context = {
    window,
    location,
    history,
    document: {
      currentScript: { dataset: { site: opts.site ?? 'demo' }, src: 'https://pulse.example/p.js' },
      readyState: opts.readyState ?? 'complete',
      referrer: 'https://news.example/item',
    },
    navigator: {
      sendBeacon: (url: string, body: string) => {
        beacons.push({ url, body: JSON.parse(body) });
        return true;
      },
    },
    performance: { getEntriesByType: () => [{ loadEventEnd: 812.4 }] },
    setTimeout: (fn: () => void) => fn(),
    URL,
    JSON,
    Math,
  };
  runInNewContext(bundle.code, context);
  return { beacons, location, history, window, listeners };
}

describe('tracker', () => {
  it(`stays within the ${TRACKER_BUDGET_BYTES} byte budget`, () => {
    expect(bundle.bytes).toBeLessThanOrEqual(TRACKER_BUDGET_BYTES);
    expect(bundle.gzipBytes).toBeLessThan(1024);
  });

  it('sends a pageview beacon on load with referrer, width and load time', () => {
    const { beacons } = sandbox();
    expect(beacons).toEqual([
      {
        url: 'https://pulse.example/api/event',
        body: {
          s: 'demo',
          u: 'https://demo.example/',
          r: 'https://news.example/item',
          w: 1280,
          l: 812,
        },
      },
    ]);
  });

  it('tracks SPA navigations once per URL and omits load time after the first view', () => {
    const { beacons, location, history, listeners } = sandbox();
    location.href = 'https://demo.example/pricing';
    history.pushState();
    history.replaceState(); // same URL → ignored
    location.href = 'https://demo.example/';
    listeners.popstate!.forEach((fn) => fn());
    expect(beacons.map((b) => b.body.u)).toEqual([
      'https://demo.example/',
      'https://demo.example/pricing',
      'https://demo.example/',
    ]);
    expect(beacons[1]!.body.l).toBeUndefined();
  });

  it('waits for the load event and respects the opt-out flag', () => {
    const waiting = sandbox({ readyState: 'loading' });
    expect(waiting.beacons).toHaveLength(0);
    waiting.listeners.load!.forEach((fn) => fn());
    expect(waiting.beacons).toHaveLength(1);
    expect(sandbox({ ignore: true }).beacons).toHaveLength(0);
    expect(sandbox({ site: '' }).beacons).toHaveLength(0);
  });
});

describe('csv', () => {
  it('quotes and neutralises formulas', () => {
    expect(
      toCsv(
        ['a', 'b'],
        [
          ['=cmd()', 'x,"y"'],
          [null, 3],
        ],
      ),
    ).toBe('a,b\r\n\'=cmd(),"x,""y"""\r\n,3\r\n');
  });
});

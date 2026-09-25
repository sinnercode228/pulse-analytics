/**
 * Replays live synthetic traffic against a running server through the real
 * ingestion endpoint (tracker payload + headers), e.g. `npm run simulate`.
 */
import { hash32 } from '@pulse/core';
import { SITE_PROFILES, TrafficSimulator } from '@pulse/core/synth';

const api = process.env.PULSE_API ?? 'http://127.0.0.1:8787';
const speed = Number(process.env.SPEED ?? 1);
const UA: Record<string, string> = {
  Chrome:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
  Safari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  Firefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0',
  Edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 Edg/140.0',
};

const sims = SITE_PROFILES.map((profile) => ({
  profile,
  sim: new TrafficSimulator({
    profile,
    start: Date.now(),
    anchor: Date.now(),
    seed: Date.now() % 1000,
  }),
}));

let clock = Date.now();
let sent = 0;
setInterval(() => {
  clock += 1000 * speed;
  for (const { profile, sim } of sims) {
    sim.advance(clock, (e) => {
      const ip = `10.${hash32(e.visitorId) & 255}.${hash32(e.visitorId, 1) & 255}.${hash32(e.visitorId, 2) & 255}`;
      const width = e.device === 'mobile' ? 390 : e.device === 'tablet' ? 900 : 1440;
      void fetch(`${api}/api/event`, {
        method: 'POST',
        headers: {
          'content-type': 'text/plain',
          'user-agent': UA[e.browser] ?? UA.Chrome!,
          'x-forwarded-for': ip,
          'x-country-code': e.country,
        },
        body: JSON.stringify({
          s: profile.id,
          u: `https://${profile.domain}${e.path}`,
          r: e.referrer === '(direct)' ? '' : `https://${e.referrer}/`,
          w: width,
          l: e.loadMs,
        }),
      }).then(
        () => sent++,
        () => undefined,
      );
    });
  }
}, 1000);
setInterval(() => console.log(`sent ${sent} pageviews`), 10_000);

# Pulse

[Русский](README.md) · **English**

Pulse is cookieless web analytics and uptime monitoring in one dashboard. The tracker is 843 bytes minified (560 gzipped) and sends pageviews to a Fastify server, which aggregates them into per-minute, hourly and daily rollups in SQLite and streams a live feed over WebSocket.

![The Pulse dashboard: KPIs, traffic chart, realtime feed, top pages and sources](docs/screenshots/dashboard.png)

Demo without a backend: https://sinnercode228.github.io/pulse-analytics/

The demo runs the same engine from `packages/core` as the server. `DemoEngine` ([`web/src/data/demo/engine.ts`](web/src/data/demo/engine.ts)) pushes traffic through `RollupBuilder` and the same query functions. The only difference is its store: it's in memory, with the same interface as the SQLite repository. It generates 30 days of history the first time a site is queried, and after that it adds new traffic once a second. All of this runs in a Web Worker ([`DemoDataSource.ts`](web/src/data/demo/DemoDataSource.ts)) so generation and queries don't block the UI thread. The demo sites (Orbitly, Kestrel, Fernwood) and their traffic are synthetic. With `?source=api&api=https://…` in the URL, the same dashboard talks to a real API.

Pulse is written in TypeScript and split into npm workspaces. `packages/core` is a dependency-free engine shared by the server and the browser; `server` is Fastify 5, `@fastify/websocket`, the built-in `node:sqlite` and esbuild for the tracker; `web` is React 19, Vite, uPlot, TanStack Virtual and Zustand.

## The path of a single pageview

The tracker ([`server/tracker/tracker.ts`](server/tracker/tracker.ts)) fires after `load`, and in SPAs also on `pushState`, `replaceState` and `popstate`. It sends the body as a string (`text/plain`) through `navigator.sendBeacon`, so the request needs no CORS preflight; if there's no `sendBeacon` or it returns `false`, the same body goes out through `fetch` with `keepalive`. `POST /api/event` ([`server/src/routes/ingest.ts`](server/src/routes/ingest.ts)) returns 404 for an unknown site and 422 for a URL that isn't on the site's domain or one of its subdomains, and [`misc.test.ts`](packages/core/test/misc.test.ts) checks that `acme.example.evil.test` doesn't pass for `acme.example`. The URL being checked comes from the request body, so this doesn't protect against spoofing. Bots (an empty User-Agent or one shorter than 10 characters, or a match against `BOT_RE` from [`packages/core/src/ua.ts`](packages/core/src/ua.ts)) get a 202 so they don't retry, and the server drops the event.

Next, `IngestPipeline` ([`server/src/ingest/pipeline.ts`](server/src/ingest/pipeline.ts)) adds the event to an in-memory `RollupBuilder`. One pageview touches 18 buffer rows (three tiers times six dimensions: total, page, referrer, country, device, browser). A new row only appears for a new bucket or value; otherwise the existing row's counters and sketch grow. The buffer goes to SQLite in a single transaction every 2 seconds or at 5,000 rows, and every stats query calls `flush()` first ([`server/src/stats/service.ts`](server/src/stats/service.ts)), so an accepted pageview shows up in reports right away; if the process crashes, whatever came in after the last flush is lost. Meanwhile `LiveHub` ([`server/src/live/hub.ts`](server/src/live/hub.ts)) sends the pageview over WebSocket, and the dashboard updates the live feed and "Online now", the number of visitors in the last 5 minutes ([`active.ts`](packages/core/src/active.ts)). The dashboard refetches charts and KPIs every 10 seconds while the window reaches "now" and the tab is visible.

## What counts as one visitor

The tracker doesn't store anything in the browser. It only reads the `localStorage.pulse_ignore` flag, which you can set to exclude your own visits. The visitor id is `hash32("salt|site|ip|ua")` computed twice, with seeds 1 and 2; both numbers are converted to base36 and joined into one string ([`server/src/ingest/parse.ts`](server/src/ingest/parse.ts)). The salt is 16 random bytes per UTC day, kept in the `salts` table; when a new one is created, everything older than yesterday's is deleted ([`server/src/ingest/salt.ts`](server/src/ingest/salt.ts)). The salt lives in the database, not in process memory, so a restart in the middle of the day doesn't change the ids. Neither the IP nor the User-Agent string is written to the database, only the hash, and the country comes from CDN headers like `cf-ipcountry`; Pulse has no IP geolocation of its own. The IP still ends up in the logs, though, because Fastify's standard request log (enabled in [`server/src/index.ts`](server/src/index.ts)) records `remoteAddress`.

Because the salt is per day, the same person gets different ids on different days, and "Unique visitors" over a range of several days is closer to the number of visitor-days than to the number of people. Also, the salt changes at midnight UTC, while daily buckets are cut at midnight in the site's time zone. If that zone isn't UTC (UTC is the default), a visitor who came before and after midnight UTC within the same local day is counted twice in the daily bucket.

## A sketch in every rollup row

You can't simply add up visitors across buckets, so every rollup row holds a HyperLogLog sketch ([`packages/core/src/hll.ts`](packages/core/src/hll.ts)): precision 11, 2048 registers, ~2.3% standard error. As long as there are no more than 512 hashes, the sketch keeps them as an exact set of 32-bit values, like the sparse mode in HLL++, and that's usually the case for rows like "one page in one hour". At the 513th hash it switches to dense registers, because 512 values of 4 bytes each take as much space as 2048 one-byte registers (2 KiB). In SQLite the sketch is stored in a BLOB column. The tests in [`packages/core/test/hll.test.ts`](packages/core/test/hll.test.ts) require 300 values in sparse mode to be counted exactly, the error at 100,000 to be under 3%, and the union of two sets of 4,000 that overlap by 2,000 to give 6,000 within 4%.

Sketches can be merged, so the `rollups` table behaves like an `AggregatingMergeTree` with `uniqState`/`uniqMerge` in ClickHouse. `upsert` reads the existing row, merges the sketches, adds up the counters and writes the row back, all in one transaction ([`server/src/db/rollup-repo.ts`](server/src/db/rollup-repo.ts)), so a flush can write partial aggregates any number of times. The test [`server/test/rollup-repo.test.ts`](server/test/rollup-repo.test.ts) writes two days of synthetic data to SQLite in batches of 1,500 events and to the in-memory store in a single batch, then compares summary, timeseries and breakdown with `toEqual`.

The hash is MurmurHash3 (x86, 32-bit) built on `Math.imul` ([`packages/core/src/hash.ts`](packages/core/src/hash.ts)). It gives the same output in Node and in the browser, so from the same data the server and the demo build byte-for-byte identical sketches.

## Three storage tiers

Raw pageviews aren't stored at all, only rollups ([`packages/core/src/store.ts`](packages/core/src/store.ts)):

| Tier | Kept for | Picked automatically if |
| --- | --- | --- |
| `minute` | 2 days | the window is ≤ 3 h 1 min and starts no earlier than 2 days ago |
| `hour` | 35 days | the window is ≤ 8 days 1 h and starts no earlier than 35 days ago |
| `day` | indefinitely | in every other case |

`chooseInterval` ([`packages/core/src/query.ts`](packages/core/src/query.ts)) picks the finest tier that puts no more than ~200 points on the chart and whose data hasn't been deleted yet. Cleanup runs once an hour and keeps one extra hour, so a window that starts exactly at the retention boundary doesn't lose its first bucket.

Each rollup row describes one dimension, so you can only break down by one at a time. "Page × country", or a new dimension added after the fact, can't be computed: there are no raw events to compute it from.

## Where the clock lies

### Rounding the range

Both ends of the window are rounded down to a bucket boundary ([`packages/core/src/query.ts`](packages/core/src/query.ts)), so the current and previous periods never share a bucket. A window that reaches "now" keeps the unfinished bucket; otherwise the latest data would drop off the chart.

### +3000% against a period that didn't exist

KPIs are compared with a window of the same length right before the current one. If there isn't enough history to cover that window, the delta is meaningless. Here's the example from the comment on `queryPreviousSummary`:

> Without this, a 30-day view over a site with 31 days of data compares against a single day and reports +3000%.

For windows of a day or longer, I first look at the first tenth of the previous period. If it has no pageviews at all, an empty summary comes back and the dashboard shows "no previous data" instead of a delta. It's a crude heuristic. A site that really had no traffic on those days gets "no previous data" too.

### 23- and 25-hour days

A daily bucket starts at local midnight in the site's time zone ([`packages/core/src/time.ts`](packages/core/src/time.ts)). To get the next bucket, the code adds 26 hours (even across a clock change, that point lands in the next local day) and rounds down to local midnight again from there. A test in [`packages/core/test/time.test.ts`](packages/core/test/time.test.ts) checks 23- and 25-hour days in `America/New_York`.

## Uptime, and a second process on the same database

![The uptime page: monitors, 90-day bar, incidents](docs/screenshots/uptime.png)

`performCheck` ([`server/src/uptime/checker.ts`](server/src/uptime/checker.ts)) catches network errors and timeouts and records them as a failed check. By default a monitor is checked once a minute with a 10-second timeout, and a response slower than 1,000 ms counts as degraded. Raw checks are kept for 7 days. There's a daily summary in `uptime_daily`, and the 90-day bar is built from it, with thresholds at 99.99% / 99% / 95%.

In the demo, the "Webhook relay" monitor is scripted to go down with HTTP 500 about a minute after you first open the uptime page and to come back up 6 minutes later ([`packages/core/src/synth/uptime.ts`](packages/core/src/synth/uptime.ts)). You can watch an incident open and close on it.

Checks run inside the API (`UPTIME_MODE=inline`) or as a separate [`uptime-worker`](server/src/uptime-worker.ts) process on the same database file. The built-in `node:sqlite` doesn't need a native addon to be compiled, and the database is opened in WAL mode so the API and the uptime worker can work with one file (see the header comment in [`server/src/db/database.ts`](server/src/db/database.ts)). Along with WAL, it sets `synchronous = NORMAL` and `busy_timeout = 5000`, and the schema is migrated through `PRAGMA user_version`. The separate worker has no `LiveHub`, so under `docker compose` the uptime page only updates by refetching every 10 seconds.

## What's not done yet

- There are no alerts; a down monitor only shows up on the dashboard. The first failed check opens an incident and the first successful one closes it ([`packages/core/src/uptime.ts`](packages/core/src/uptime.ts)), so a single timeout makes an incident of its own.
- The WebSocket has no ping and no backpressure. The client reconnects after 1 s × 2ⁿ (up to 30 s) with no jitter, and events that happen while it's disconnected aren't resent.
- `/api/event` has no rate limit. The read API is open without auth; `ADMIN_TOKEN` only protects `POST /api/admin/*`.
- `TRUST_PROXY` is on by default. If there's no proxy in front of the server, a client can send its own `X-Forwarded-For`, and that address goes into the visitor hash.

## Running your own instance

You need Node 24 (`.nvmrc`) or 22.18+: `build:tracker` imports `.ts` with plain `node`, and type stripping has been on by default since 22.18.

```bash
npm ci
npm run dev                          # dashboard only, on demo data: http://localhost:5173

# with the backend
npm run seed                         # 30 days of synthetic data in server/data/pulse.db: 3 sites, 6 paused monitors, API self-check
npm run dev:api                      # API and tracker (/p.js) on :8787
VITE_DATA_SOURCE=api npm run dev     # dashboard; Vite proxies /api and WebSocket to :8787
npm run simulate -w @pulse/server    # live synthetic traffic through the real POST /api/event

# or with Docker
docker compose up -d --build         # API + dashboard + tracker on :8787, uptime as a separate service
docker compose run --rm seed         # optional: 30 days of synthetic data into the same volume
```

To run checks in a separate process locally, start the API with `UPTIME_MODE=off` and run `npm run worker:uptime -w @pulse/server` next to it.

Adding the tracker to a site:

```html
<script defer src="https://pulse.example/p.js" data-site="my-site"></script>
```

You add a site with `POST /api/admin/sites` and `Authorization: Bearer <ADMIN_TOKEN>`; without `ADMIN_TOKEN` the admin routes are disabled. The server takes variables only from the process environment and doesn't read `.env` itself; in Docker, compose fills in `ADMIN_TOKEN` from `.env`. The variables are listed in [`.env.example`](.env.example), except `TRUST_PROXY`, which is read in [`server/src/config.ts`](server/src/config.ts).

## What CI checks

`npm test` runs 97 Vitest tests: 52 in `packages/core` (HLL, time zones and DST, rollups, queries, uptime, generators), 26 in `server` (the API via `fastify.inject`, WebSocket on a real socket, SQLite vs. in-memory parity, the tracker in `node:vm`, CSV with formula neutralization) and 19 in `web` (demo engine, components, hotkeys, API client, utilities). `npm run check` is ESLint with `--max-warnings=0`, Prettier, `tsc`, the tests and the build; CI runs the same steps on Node 22 and 24. The build fails if the tracker is over 2,048 bytes, and a test also requires it to be under 1,024 bytes gzipped.

---

Built by Грешный Котик (sinnercode). I take freelance work like this: Telegram [@sinnercode](https://t.me/sinnercode). License: [MIT](LICENSE).

import type { Device } from '../types.js';
import { Rng } from './prng.js';

/** [ISO code, traffic share, UTC offset (h), page-load factor] */
export type CountryWeight = readonly [
  code: string,
  share: number,
  utcOffset: number,
  loadFactor: number,
];

export interface Spike {
  /** Days before "now" when the spike starts. */
  daysAgo: number;
  referrer: string;
  /** Peak multiplier on top of normal traffic. */
  multiplier: number;
  /** e-folding decay time, hours. */
  decayHours: number;
  /** Landing page the spike points to (defaults to the regular entry distribution). */
  page?: string;
}

export interface SiteProfile {
  id: string;
  name: string;
  domain: string;
  dailyVisitors: number;
  pagesPerVisit: number;
  returningRate: number;
  /** Sun..Sat multipliers. */
  weekday: readonly number[];
  /** Weights of the work-hours and evening bumps of the daily curve. */
  diurnal: readonly [work: number, evening: number];
  /** Linear growth per day, e.g. 0.004 = +0.4 %/day. */
  growthPerDay: number;
  pages: readonly string[];
  /** Index into `pages` that most sessions land on first. */
  entryBias: readonly string[];
  referrers: readonly (readonly [string, number])[];
  countries: readonly CountryWeight[];
  devices: readonly (readonly [Device, number])[];
  baseLoadMs: number;
  spikes: readonly Spike[];
}

const WORLD: CountryWeight[] = [
  ['US', 0.24, -5, 1.0],
  ['DE', 0.075, 1, 0.9],
  ['IN', 0.085, 5, 1.6],
  ['GB', 0.06, 0, 0.9],
  ['FR', 0.04, 1, 0.95],
  ['BR', 0.04, -3, 1.5],
  ['CA', 0.035, -5, 1.0],
  ['RU', 0.03, 3, 1.25],
  ['NL', 0.025, 1, 0.85],
  ['PL', 0.025, 1, 1.0],
  ['JP', 0.025, 9, 1.2],
  ['UA', 0.02, 2, 1.2],
  ['CN', 0.02, 8, 2.1],
  ['ES', 0.02, 1, 1.0],
  ['IT', 0.018, 1, 1.0],
  ['KR', 0.015, 9, 1.1],
  ['AU', 0.015, 10, 1.4],
  ['SE', 0.012, 1, 0.9],
  ['TR', 0.012, 3, 1.3],
  ['ID', 0.012, 7, 1.7],
  ['MX', 0.012, -6, 1.3],
  ['VN', 0.01, 7, 1.6],
  ['CH', 0.008, 1, 0.85],
  ['SG', 0.008, 8, 1.1],
  ['AR', 0.008, -3, 1.5],
  ['PH', 0.007, 8, 1.7],
  ['CZ', 0.007, 1, 1.0],
  ['IL', 0.007, 2, 1.2],
  ['BE', 0.006, 1, 0.9],
  ['AT', 0.006, 1, 0.9],
  ['PT', 0.006, 0, 1.0],
  ['TH', 0.006, 7, 1.5],
  ['NG', 0.006, 1, 2.0],
  ['KZ', 0.005, 5, 1.4],
  ['FI', 0.005, 2, 0.9],
  ['NO', 0.005, 1, 0.9],
  ['DK', 0.005, 1, 0.9],
  ['IE', 0.005, 0, 0.9],
  ['EG', 0.005, 2, 1.8],
  ['ZA', 0.005, 2, 1.8],
  ['RO', 0.005, 2, 1.1],
  ['GE', 0.003, 4, 1.3],
  ['AM', 0.003, 4, 1.3],
  ['RS', 0.003, 1, 1.1],
  ['NZ', 0.003, 12, 1.5],
  ['ZZ', 0.008, 0, 1.2],
];

function reweight(boost: Record<string, number>, keepTail = 1): CountryWeight[] {
  return WORLD.map(
    ([code, share, offset, load]) =>
      [code, share * (boost[code] ?? keepTail), offset, load] as const,
  );
}

function slugs(rng: Rng, a: readonly string[], b: readonly string[], n: number): string[] {
  const out = new Set<string>();
  let guard = 0;
  while (out.size < n && guard++ < n * 50) out.add(`${rng.pick(a)}-${rng.pick(b)}`);
  return [...out];
}

function orbitlyPages(): string[] {
  const rng = new Rng(11);
  const resources = [
    'projects',
    'deployments',
    'domains',
    'env-vars',
    'teams',
    'tokens',
    'webhooks',
    'logs',
    'builds',
    'regions',
    'secrets',
    'members',
    'invoices',
    'usage',
    'audit-log',
  ];
  const actions = ['overview', 'create', 'list', 'get', 'update', 'delete'];
  const langs = ['js', 'python', 'go', 'rust', 'ruby', 'php', 'java'];
  const sdkTopics = [
    'install',
    'auth',
    'pagination',
    'errors',
    'retries',
    'streaming',
    'webhooks',
    'testing',
  ];
  const verbs = [
    'deploy',
    'scale',
    'migrate',
    'debug',
    'secure',
    'cache',
    'monitor',
    'rollback',
    'preview',
    'automate',
  ];
  const nouns = [
    'monorepos',
    'edge-functions',
    'static-sites',
    'cron-jobs',
    'queues',
    'databases',
    'websockets',
    'images',
    'workers',
    'feature-flags',
    'secrets',
    'ci-pipelines',
  ];
  const cli = [
    'login',
    'init',
    'link',
    'deploy',
    'logs',
    'env-pull',
    'env-add',
    'domains',
    'rollback',
    'promote',
    'inspect',
    'whoami',
    'teams',
    'tokens',
    'build',
    'dev',
    'pull',
    'redeploy',
    'alias',
    'certs',
    'dns',
    'secrets',
    'projects',
    'regions',
    'open',
    'help',
    'update',
    'telemetry',
    'switch',
    'remove',
  ];
  const head = [
    '/',
    '/docs',
    '/docs/quickstart',
    '/pricing',
    '/docs/installation',
    '/changelog',
    '/blog',
    '/docs/concepts/projects',
    '/docs/concepts/deployments',
    '/docs/limits',
    '/status',
    '/docs/cli',
    '/docs/api',
    '/signup',
    '/login',
  ];
  const pages = [
    ...head,
    ...resources.flatMap((r) => actions.map((a) => `/docs/api/${r}/${a}`)),
    ...slugs(rng, verbs, nouns, 40).map((s) => `/docs/guides/${s}`),
    ...langs.flatMap((l) => sdkTopics.map((t) => `/docs/sdk/${l}/${t}`)),
    ...cli.map((c) => `/docs/cli/${c}`),
    ...slugs(
      rng,
      ['why', 'how', 'shipping', 'inside', 'faster', 'building', 'rethinking', 'scaling'],
      [
        'cold-starts',
        'build-cache',
        'preview-urls',
        'edge-routing',
        'zero-downtime',
        'our-cdn',
        'log-drains',
        'incremental-builds',
        'rust-rewrite',
        'observability',
      ],
      50,
    ).map((s) => `/blog/${s}`),
    ...Array.from(
      { length: 24 },
      (_, i) => `/changelog/${2024 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`,
    ),
    ...slugs(
      rng,
      [
        'nextjs',
        'astro',
        'svelte',
        'remix',
        'nuxt',
        'hono',
        'fastify',
        'django',
        'rails',
        'laravel',
      ],
      ['starter', 'blog', 'shop', 'dashboard', 'api', 'chat', 'auth'],
      40,
    ).map((s) => `/examples/${s}`),
    ...Array.from({ length: 150 }, (_, i) => `/docs/errors/E${1001 + i}`),
  ];
  return shuffleTail(pages, head.length, rng);
}

function kestrelPages(): string[] {
  const rng = new Rng(23);
  const adjectives = [
    'alpine',
    'trail',
    'summit',
    'canyon',
    'glacier',
    'ridge',
    'harbor',
    'north',
    'ember',
    'drift',
    'basalt',
    'cedar',
    'tundra',
    'river',
    'granite',
  ];
  const items = [
    'jacket',
    'backpack',
    'tent',
    'sleeping-bag',
    'headlamp',
    'boots',
    'gloves',
    'beanie',
    'thermos',
    'stove',
    'trekking-poles',
    'rain-shell',
    'fleece',
    'socks',
    'hammock',
    'daypack',
    'water-filter',
    'camp-chair',
  ];
  const collections = [
    'new-arrivals',
    'sale',
    'hiking',
    'camping',
    'climbing',
    'winter',
    'accessories',
    'footwear',
    'bags',
    'kids',
    'gift-cards',
    'bestsellers',
  ];
  const head = [
    '/',
    '/collections/new-arrivals',
    '/collections/sale',
    '/cart',
    '/checkout',
    '/search',
    '/checkout/success',
    '/account',
    '/collections/bestsellers',
  ];
  const pages = [
    ...head,
    ...collections.map((c) => `/collections/${c}`),
    ...slugs(rng, adjectives, items, 240).map((s) => `/products/${s}`),
    ...slugs(
      rng,
      ['packing', 'layering', 'choosing', 'caring-for', 'repairing'],
      ['a-tent', 'down-jackets', 'boots', 'a-backpack', 'rain-gear'],
      18,
    ).map((s) => `/journal/${s}`),
    ...[
      'shipping',
      'returns',
      'sizing',
      'warranty',
      'contact',
      'faq',
      'store-locator',
      'repairs',
    ].map((s) => `/help/${s}`),
  ];
  return shuffleTail([...new Set(pages)], head.length, rng);
}

function fernwoodPages(): string[] {
  const rng = new Rng(37);
  const first = [
    'the-quiet',
    'notes-on',
    'against',
    'in-praise-of',
    'a-field-guide-to',
    'the-last',
    'slow',
    'after',
    'small',
    'the-case-for',
  ];
  const second = [
    'cities',
    'winter',
    'libraries',
    'rivers',
    'maps',
    'boredom',
    'gardens',
    'night-trains',
    'handwriting',
    'forests',
    'radio',
    'islands',
    'attention',
    'repair',
    'weather',
  ];
  const head = ['/', '/newsletter', '/about', '/archive', '/issues/36'];
  const pages = [
    ...head,
    ...slugs(rng, first, second, 120).map((s) => `/essays/${s}`),
    ...Array.from({ length: 35 }, (_, i) => `/issues/${i + 1}`),
    ...[
      'cities',
      'nature',
      'technology',
      'books',
      'travel',
      'craft',
      'music',
      'food',
      'history',
      'science',
    ].map((t) => `/tags/${t}`),
  ];
  return shuffleTail(pages, head.length, rng);
}

/** Keep the hand-picked head in order, shuffle the long tail deterministically. */
function shuffleTail(pages: string[], headLen: number, rng: Rng): string[] {
  const tail = pages.slice(headLen);
  for (let i = tail.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [tail[i], tail[j]] = [tail[j]!, tail[i]!];
  }
  return [...pages.slice(0, headLen), ...tail];
}

export const SITE_PROFILES: readonly SiteProfile[] = [
  {
    id: 'orbitly-docs',
    name: 'Orbitly Docs',
    domain: 'docs.orbitly.example',
    dailyVisitors: 5200,
    pagesPerVisit: 2.5,
    returningRate: 0.34,
    weekday: [0.55, 1.12, 1.16, 1.15, 1.12, 1.0, 0.6],
    diurnal: [1, 0.35],
    growthPerDay: 0.004,
    pages: orbitlyPages(),
    entryBias: ['/', '/docs/quickstart', '/pricing'],
    referrers: [
      ['(direct)', 0.26],
      ['google.com', 0.4],
      ['github.com', 0.08],
      ['stackoverflow.com', 0.04],
      ['duckduckgo.com', 0.03],
      ['bing.com', 0.03],
      ['chatgpt.com', 0.025],
      ['news.ycombinator.com', 0.015],
      ['reddit.com', 0.015],
      ['dev.to', 0.01],
      ['newsletter', 0.02],
      ['t.co', 0.008],
      ['linkedin.com', 0.007],
      ['perplexity.ai', 0.006],
      ['yandex.ru', 0.006],
      ['lobste.rs', 0.003],
    ],
    countries: WORLD,
    devices: [
      ['desktop', 0.78],
      ['mobile', 0.19],
      ['tablet', 0.03],
    ],
    baseLoadMs: 940,
    spikes: [
      {
        daysAgo: 9.4,
        referrer: 'news.ycombinator.com',
        multiplier: 3.2,
        decayHours: 14,
        page: '/blog/how-rust-rewrite',
      },
      { daysAgo: 22.6, referrer: 'reddit.com', multiplier: 1.6, decayHours: 10 },
    ],
  },
  {
    id: 'kestrel-shop',
    name: 'Kestrel Supply',
    domain: 'shop.kestrel.example',
    dailyVisitors: 2600,
    pagesPerVisit: 3.4,
    returningRate: 0.27,
    weekday: [1.2, 0.95, 0.9, 0.92, 0.95, 1.0, 1.15],
    diurnal: [0.55, 1],
    growthPerDay: 0.002,
    pages: kestrelPages(),
    entryBias: ['/', '/collections/sale', '/collections/new-arrivals'],
    referrers: [
      ['(direct)', 0.3],
      ['google.com', 0.3],
      ['instagram.com', 0.1],
      ['newsletter', 0.08],
      ['pinterest.com', 0.05],
      ['facebook.com', 0.04],
      ['bing.com', 0.03],
      ['youtube.com', 0.03],
      ['tiktok.com', 0.03],
      ['duckduckgo.com', 0.02],
      ['reddit.com', 0.01],
    ],
    countries: reweight(
      {
        US: 1.8,
        CA: 2.2,
        GB: 1.8,
        DE: 1.4,
        AU: 2.5,
        NL: 1.4,
        SE: 2,
        NO: 2.5,
        CH: 2,
        IN: 0.15,
        CN: 0.05,
        BR: 0.3,
        NG: 0.1,
        VN: 0.2,
        ID: 0.2,
        PH: 0.2,
      },
      0.6,
    ),
    devices: [
      ['mobile', 0.58],
      ['desktop', 0.36],
      ['tablet', 0.06],
    ],
    baseLoadMs: 1580,
    spikes: [
      {
        daysAgo: 5.3,
        referrer: 'newsletter',
        multiplier: 2.4,
        decayHours: 6,
        page: '/collections/sale',
      },
      {
        daysAgo: 18.2,
        referrer: 'instagram.com',
        multiplier: 1.8,
        decayHours: 9,
        page: '/products/glacier-rain-shell',
      },
    ],
  },
  {
    id: 'fernwood-journal',
    name: 'Fernwood Journal',
    domain: 'fernwood.example',
    dailyVisitors: 1500,
    pagesPerVisit: 1.6,
    returningRate: 0.22,
    weekday: [1.15, 1.0, 0.95, 0.95, 0.95, 0.9, 1.1],
    diurnal: [0.6, 1],
    growthPerDay: 0.001,
    pages: fernwoodPages(),
    entryBias: ['/', '/newsletter', '/issues/36'],
    referrers: [
      ['(direct)', 0.22],
      ['google.com', 0.22],
      ['newsletter', 0.18],
      ['t.co', 0.08],
      ['news.ycombinator.com', 0.06],
      ['reddit.com', 0.05],
      ['facebook.com', 0.04],
      ['bsky.app', 0.04],
      ['mastodon.social', 0.03],
      ['flipboard.com', 0.02],
      ['yandex.ru', 0.02],
      ['vk.com', 0.01],
      ['telegram.org', 0.03],
    ],
    countries: reweight(
      { US: 1.3, GB: 1.8, RU: 2.5, UA: 1.8, KZ: 2, DE: 1.2, CN: 0.1, IN: 0.3 },
      0.8,
    ),
    devices: [
      ['mobile', 0.52],
      ['desktop', 0.42],
      ['tablet', 0.06],
    ],
    baseLoadMs: 1180,
    spikes: [{ daysAgo: 16.5, referrer: 'news.ycombinator.com', multiplier: 5, decayHours: 16 }],
  },
];

export const BROWSERS: Record<Device, readonly (readonly [string, number])[]> = {
  desktop: [
    ['Chrome', 0.61],
    ['Safari', 0.13],
    ['Edge', 0.11],
    ['Firefox', 0.1],
    ['Opera', 0.02],
    ['Yandex Browser', 0.02],
    ['Other', 0.01],
  ],
  mobile: [
    ['Chrome', 0.52],
    ['Safari', 0.39],
    ['Samsung Internet', 0.05],
    ['Firefox', 0.02],
    ['Other', 0.02],
  ],
  tablet: [
    ['Safari', 0.6],
    ['Chrome', 0.34],
    ['Samsung Internet', 0.04],
    ['Other', 0.02],
  ],
};

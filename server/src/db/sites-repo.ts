import type { Site } from '@pulse/core';
import type { Db } from './database.js';

interface SiteRow {
  id: string;
  name: string;
  domain: string;
  time_zone: string;
}

/** Sites change rarely and are read on every event, so they are cached in memory. */
export class SiteRegistry {
  private cache = new Map<string, Site>();

  constructor(private readonly db: Db) {
    this.reload();
  }

  reload(): void {
    const rows = this.db
      .prepare('SELECT id, name, domain, time_zone FROM sites ORDER BY created_at, id')
      .all();
    this.cache = new Map(
      (rows as unknown as SiteRow[]).map((r) => [
        r.id,
        { id: r.id, name: r.name, domain: r.domain, timeZone: r.time_zone },
      ]),
    );
  }

  list(): Site[] {
    return [...this.cache.values()];
  }

  get(id: string): Site | undefined {
    return this.cache.get(id);
  }

  timeZone = (id: string): string => this.cache.get(id)?.timeZone ?? 'UTC';

  upsert(site: Site, now = Date.now()): Site {
    this.db
      .prepare(
        `INSERT INTO sites (id, name, domain, time_zone, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, domain = excluded.domain, time_zone = excluded.time_zone`,
      )
      .run(site.id, site.name, site.domain, site.timeZone, now);
    this.cache.set(site.id, { ...site });
    return site;
  }
}

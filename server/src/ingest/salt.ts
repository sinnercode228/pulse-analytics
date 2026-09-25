import { randomBytes } from 'node:crypto';
import { DAY } from '@pulse/core';
import type { Db } from '../db/database.js';

/**
 * Daily-rotating salt for anonymous visitor ids (no cookies, no stored IPs).
 * Yesterday's salt is deleted, so ids can never be linked across days.
 */
export class SaltStore {
  private cached: { day: number; salt: string } | null = null;

  constructor(private readonly db: Db) {}

  forTime(ts: number): string {
    const day = Math.floor(ts / DAY);
    if (this.cached?.day === day) return this.cached.salt;
    const row = this.db.prepare('SELECT salt FROM salts WHERE day = ?').get(day) as
      { salt: string } | undefined;
    let salt = row?.salt;
    if (!salt) {
      salt = randomBytes(16).toString('hex');
      this.db.prepare('INSERT OR IGNORE INTO salts (day, salt) VALUES (?, ?)').run(day, salt);
      salt = (this.db.prepare('SELECT salt FROM salts WHERE day = ?').get(day) as { salt: string })
        .salt;
      this.db.prepare('DELETE FROM salts WHERE day < ?').run(day - 1);
    }
    this.cached = { day, salt };
    return salt;
  }
}

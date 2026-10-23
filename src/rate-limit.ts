import { createHash } from 'node:crypto';

/**
 * Sliding-window limiter kept in memory. Good enough for one instance; for
 * several instances behind a load balancer, swap it for Redis with the same API.
 */
export class RateLimiter {
  readonly #hits = new Map<string, number[]>();
  readonly #limit: number;
  readonly #windowMs: number;

  constructor(limit: number, windowMs: number) {
    this.#limit = limit;
    this.#windowMs = windowMs;
  }

  hit(key: string, now = Date.now()): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
    const recent = (this.#hits.get(key) ?? []).filter((time) => time > now - this.#windowMs);

    if (recent.length >= this.#limit) {
      this.#hits.set(key, recent);
      const oldest = recent[0] ?? now;
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((oldest + this.#windowMs - now) / 1000)) };
    }

    recent.push(now);
    this.#hits.set(key, recent);
    if (this.#hits.size > 10_000) this.sweep(now);
    return { allowed: true };
  }

  /** Drops keys with no hits inside the window so memory does not grow forever. */
  sweep(now = Date.now()): void {
    for (const [key, times] of this.#hits) {
      if ((times.at(-1) ?? 0) <= now - this.#windowMs) this.#hits.delete(key);
    }
  }

  get size(): number {
    return this.#hits.size;
  }
}

/**
 * Remembers recently delivered leads so a double click or a flaky mobile
 * connection does not send the same lead twice. Stores hashes, not the data.
 */
export class RecentLeads {
  readonly #seen = new Map<string, number>();
  readonly #ttlMs: number;

  constructor(ttlMs: number) {
    this.#ttlMs = ttlMs;
  }

  static key(parts: Array<string | undefined>): string {
    return createHash('sha256').update(parts.map((part) => part ?? '').join('\u0000')).digest('base64url');
  }

  /** Returns true if the key was seen within the TTL; otherwise records it. */
  isDuplicate(key: string, now = Date.now()): boolean {
    for (const [seenKey, at] of this.#seen) {
      if (at <= now - this.#ttlMs) this.#seen.delete(seenKey);
      else break; // Map keeps insertion order, so the rest are newer
    }
    if (this.#seen.has(key)) return true;
    this.#seen.set(key, now);
    return false;
  }

  /** Forgets a key, e.g. when delivery failed and the visitor should be able to retry. */
  forget(key: string): void {
    this.#seen.delete(key);
  }
}

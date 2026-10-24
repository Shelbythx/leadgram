export interface RateLimit {
  limit: number;
  windowMs: number;
}

export type Quota = { allowed: true } | { allowed: false; retryAfterSeconds: number };

const MAX_TRACKED_KEYS = 10_000;
const MS_PER_SECOND = 1000;

export class RateLimiter {
  readonly #hitsByKey = new Map<string, number[]>();
  readonly #rule: RateLimit;

  constructor(rule: RateLimit) {
    this.#rule = rule;
  }

  consume(key: string, now: number): Quota {
    const hits = this.#hitsWithinWindow(key, now);

    if (hits.length >= this.#rule.limit) {
      this.#hitsByKey.set(key, hits);
      return { allowed: false, retryAfterSeconds: this.#secondsUntilSlotFrees(hits, now) };
    }

    this.#hitsByKey.set(key, [...hits, now]);
    if (this.#hitsByKey.size > MAX_TRACKED_KEYS) this.evictIdleKeys(now);
    return { allowed: true };
  }

  evictIdleKeys(now: number): void {
    for (const [key, hits] of this.#hitsByKey) {
      const lastHit = hits.at(-1) ?? 0;
      if (lastHit <= this.#windowStart(now)) this.#hitsByKey.delete(key);
    }
  }

  get trackedKeys(): number {
    return this.#hitsByKey.size;
  }

  #hitsWithinWindow(key: string, now: number): number[] {
    return (this.#hitsByKey.get(key) ?? []).filter((time) => time > this.#windowStart(now));
  }

  #secondsUntilSlotFrees(hits: number[], now: number): number {
    const oldestHit = hits[0] ?? now;
    return Math.max(1, Math.ceil((oldestHit + this.#rule.windowMs - now) / MS_PER_SECOND));
  }

  #windowStart(now: number): number {
    return now - this.#rule.windowMs;
  }
}

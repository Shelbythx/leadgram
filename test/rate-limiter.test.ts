import { describe, expect, it } from 'vitest';
import { RateLimiter } from '../src/protection/rate-limiter.ts';

describe('RateLimiter', () => {
  it('allows N hits per window and tells when to retry', () => {
    const limiter = new RateLimiter({ limit: 2, windowMs: 60_000 });
    expect(limiter.consume('ip', 0).allowed).toBe(true);
    expect(limiter.consume('ip', 10_000).allowed).toBe(true);
    expect(limiter.consume('ip', 20_000)).toEqual({ allowed: false, retryAfterSeconds: 40 });
    expect(limiter.consume('other-ip', 20_000).allowed).toBe(true);
  });

  it('frees a slot once the oldest hit leaves the window', () => {
    const limiter = new RateLimiter({ limit: 1, windowMs: 60_000 });
    limiter.consume('ip', 0);
    expect(limiter.consume('ip', 59_999).allowed).toBe(false);
    expect(limiter.consume('ip', 60_001).allowed).toBe(true);
  });

  it('evicts idle keys', () => {
    const limiter = new RateLimiter({ limit: 5, windowMs: 1000 });
    limiter.consume('a', 0);
    limiter.consume('b', 1500);
    limiter.evictIdleKeys(2000);
    expect(limiter.trackedKeys).toBe(1);
  });
});

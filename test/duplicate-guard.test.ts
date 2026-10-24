import { describe, expect, it } from 'vitest';
import { DuplicateGuard, fingerprint } from '../src/protection/duplicate-guard.ts';

describe('DuplicateGuard', () => {
  const key = fingerprint('1.2.3.4', '+380671234567');

  it('reports remembered keys within the TTL only', () => {
    const guard = new DuplicateGuard(60_000);
    expect(guard.has(key, 0)).toBe(false);
    guard.remember(key, 0);
    expect(guard.has(key, 30_000)).toBe(true);
    expect(guard.has(key, 61_000)).toBe(false);
  });

  it('can forget a key so the visitor may retry', () => {
    const guard = new DuplicateGuard(60_000);
    guard.remember(key, 0);
    guard.forget(key);
    expect(guard.has(key, 1)).toBe(false);
  });
});

describe('fingerprint', () => {
  it('is stable and does not reveal the data', () => {
    const phone = '+380671234567';
    expect(fingerprint('1.2.3.4', phone)).toBe(fingerprint('1.2.3.4', phone));
    expect(fingerprint('1.2.3.4', phone)).not.toContain('380671234567');
  });

  it('keeps part boundaries', () => {
    expect(fingerprint('ab', 'c')).not.toBe(fingerprint('a', 'bc'));
    expect(fingerprint('a', undefined)).toBe(fingerprint('a', ''));
  });
});

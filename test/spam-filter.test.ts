import { describe, expect, it } from 'vitest';
import { detectSpam } from '../src/protection/spam-filter.ts';

const rules = { minFillMs: 3000, maxLinks: 2 };
const now = 100_000;

describe('detectSpam', () => {
  it('passes a normal submission', () => {
    expect(detectSpam({ phone: '0671234567', _t: '90000' }, rules, now)).toBeUndefined();
  });

  it('catches a filled honeypot', () => {
    expect(detectSpam({ phone: '0671234567', _gotcha: 'http://spam' }, rules, now)).toBe('honeypot');
  });

  it('catches forms submitted faster than a human can type', () => {
    expect(detectSpam({ phone: '0671234567', _t: '99500' }, rules, now)).toBe('too_fast');
  });

  it.each([undefined, 'abc', '999999999'])('skips the timing check for render time %s', (renderedAt) => {
    const fields: Record<string, string> = renderedAt === undefined ? { phone: '0671234567' } : { phone: '0671234567', _t: renderedAt };
    expect(detectSpam(fields, rules, now)).toBeUndefined();
  });

  it('catches link spam but allows a single link', () => {
    expect(detectSpam({ email: 'a@b.co', message: 'cheap http://a.example https://b.example www.c.example' }, rules, now)).toBe(
      'too_many_links',
    );
    expect(detectSpam({ email: 'a@b.co', message: 'see https://my-site.example' }, rules, now)).toBeUndefined();
  });
});

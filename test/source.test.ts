import { describe, expect, it } from 'vitest';
import { parseWebUrl, utmParameters } from '../src/lead/source.ts';

describe('parseWebUrl', () => {
  it.each(['https://cafe.example/', 'http://localhost:3000/demo'])('accepts %s', (value) => {
    expect(parseWebUrl(value)?.href).toBe(value);
  });

  it.each([undefined, '', 'not a url', 'javascript:alert(1)', 'ftp://cafe.example'])('rejects %s', (value) => {
    expect(parseWebUrl(value)).toBeUndefined();
  });
});

describe('utmParameters', () => {
  it('keeps known UTM tags in a fixed order and skips empty ones', () => {
    const page = new URL('https://cafe.example/?utm_campaign=autumn&utm_source=instagram&utm_medium=&ref=x');
    expect(Object.entries(utmParameters(page))).toEqual([
      ['source', 'instagram'],
      ['campaign', 'autumn'],
    ]);
  });

  it('returns nothing without a page', () => {
    expect(utmParameters(undefined)).toEqual({});
  });
});

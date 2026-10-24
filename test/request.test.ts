import type { Context } from 'hono';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { clientIpResolver, readFormFields } from '../src/http/request.ts';

function contextWithHeaders(headers: Record<string, string>): Context {
  return { req: { header: (name: string) => headers[name] } } as unknown as Context;
}

async function fieldsFrom(contentType: string, body: string) {
  const app = new Hono().post('/', async (c) => c.json((await readFormFields(c.req)) ?? null));
  const response = await app.request('/', { method: 'POST', headers: { 'content-type': contentType }, body });
  return response.json();
}

describe('readFormFields', () => {
  it('reads JSON objects and keeps only scalar values', async () => {
    expect(await fieldsFrom('application/json', '{"name":"Олена","guests":40,"agree":true,"nested":{"a":1}}')).toEqual({
      name: 'Олена',
      guests: '40',
      agree: 'true',
    });
  });

  it('joins repeated form values', async () => {
    expect(await fieldsFrom('application/x-www-form-urlencoded', 'extras=Coffee&extras=Tea')).toEqual({ extras: 'Coffee, Tea' });
  });

  it.each([
    ['application/json', '{not json'],
    ['application/json', '[1,2]'],
    ['text/plain', 'hi'],
  ])('returns nothing for %s %s', async (contentType, body) => {
    expect(await fieldsFrom(contentType, body)).toBeNull();
  });
});

describe('clientIpResolver', () => {
  const forwarded = contextWithHeaders({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' });

  it('uses X-Forwarded-For only behind a trusted proxy', () => {
    expect(clientIpResolver(true, () => '10.0.0.1')(forwarded)).toBe('203.0.113.7');
    expect(clientIpResolver(false, () => '10.0.0.1')(forwarded)).toBe('10.0.0.1');
  });

  it('falls back to "unknown" when the socket address is missing', () => {
    expect(clientIpResolver(false, () => undefined)(contextWithHeaders({}))).toBe('unknown');
  });
});

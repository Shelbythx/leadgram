import type { Context } from 'hono';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { clientIpResolver, readSubmission } from '../src/http/request.ts';
import { fileWith, JPEG_HEADER } from './support/files.ts';

function contextWithHeaders(headers: Record<string, string>): Context {
  return { req: { header: (name: string) => headers[name] } } as unknown as Context;
}

async function submissionFrom(body: string | FormData, contentType?: string) {
  const app = new Hono().post('/', async (c) => {
    const submission = await readSubmission(c.req);
    return c.json(submission ? { fields: submission.fields, files: submission.files.map(({ fieldName, file }) => [fieldName, file.name, file.size]) } : null);
  });
  const response = await app.request('/', { method: 'POST', headers: contentType ? { 'content-type': contentType } : {}, body });
  return response.json();
}

async function fieldsFrom(contentType: string, body: string) {
  return (await submissionFrom(body, contentType))?.fields ?? null;
}

describe('readSubmission', () => {
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
    expect(await submissionFrom(body, contentType)).toBeNull();
  });

  it('separates uploaded files from text fields and skips empty file inputs', async () => {
    const form = new FormData();
    form.append('phone', '0671234567');
    form.append('photos', fileWith(JPEG_HEADER, 'hall.jpg', 100));
    form.append('photos', fileWith(JPEG_HEADER, 'stage.jpg', 200));
    form.append('documents', new File([], ''));

    const submission = await submissionFrom(form);
    expect(submission.fields.phone).toBe('0671234567');
    expect(submission.files).toEqual([
      ['photos', 'hall.jpg', 100],
      ['photos', 'stage.jpg', 200],
    ]);
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

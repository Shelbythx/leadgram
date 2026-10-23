import type { Context } from 'hono';
import { describe, expect, it } from 'vitest';
import { createApp, proxyAwareIp } from '../src/app.ts';
import type { Config } from '../src/config.ts';
import { messages } from '../src/i18n.ts';
import { silentLogger } from '../src/log.ts';
import { FakeNotifier, testConfig } from './helpers.ts';

const START = 1_000_000;
const SITE = 'https://cafe.example';

function setup(overrides: Partial<Config> = {}) {
  const notifier = new FakeNotifier();
  let time = START;
  const app = createApp({
    config: testConfig(overrides),
    notifier,
    clientIp: (c) => c.req.header('x-test-ip') ?? '10.0.0.1',
    logger: silentLogger,
    now: () => time,
    widgetScript: 'window.Leadgram={}',
  });

  const post = (body: Record<string, string> | string, options: { form?: boolean; origin?: string | null; headers?: Record<string, string> } = {}) => {
    const headers: Record<string, string> = {
      'content-type': options.form ? 'application/x-www-form-urlencoded' : 'application/json',
      ...(options.form ? { accept: 'text/html' } : { accept: 'application/json' }),
      ...(options.origin === null ? {} : { origin: options.origin ?? SITE }),
      ...options.headers,
    };
    const payload = typeof body === 'string' ? body : options.form ? new URLSearchParams(body).toString() : JSON.stringify(body);
    return app.request('/lead', { method: 'POST', headers, body: payload });
  };

  return { app, notifier, post, advance: (ms: number) => (time += ms) };
}

/** A lead as the widget sends it: rendered 10 seconds ago. */
const lead = (extra: Record<string, string> = {}) => ({ name: 'Олена', phone: '067 123 45 67', _t: String(START - 10_000), ...extra });

describe('POST /lead', () => {
  it('delivers a valid lead to Telegram', async () => {
    const { post, notifier } = setup();
    const response = await post(lead({ guests: '20–50' }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(notifier.sent).toHaveLength(1);
    expect(notifier.sent[0]).toContain('+380671234567');
    expect(notifier.sent[0]).toContain('Guests: 20–50');
  });

  it('returns field errors for invalid input', async () => {
    const { post, notifier } = setup();
    const response = await post({ name: 'Олена', phone: 'nope' });

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      ok: false,
      error: 'validation',
      message: messages.uk.errors.invalidPhone,
      fields: { phone: messages.uk.errors.invalidPhone },
    });
    expect(notifier.sent).toHaveLength(0);
  });

  it('pretends to accept spam but does not deliver it', async () => {
    const { post, notifier } = setup();
    const honeypot = await post(lead({ _gotcha: 'filled by a bot' }));
    const tooFast = await post(lead({ _t: String(START - 500) }));

    expect(honeypot.status).toBe(200);
    expect(tooFast.status).toBe(200);
    expect(notifier.sent).toHaveLength(0);
  });

  it('rejects other origins but allows the server’s own origin', async () => {
    const { post } = setup();
    const foreign = await post(lead(), { origin: 'https://evil.example' });
    expect(foreign.status).toBe(403);
    expect((await foreign.json()).error).toBe('forbidden_origin');

    expect((await post(lead(), { origin: 'http://localhost' })).status).toBe(200);
    expect((await post(lead({ phone: '0501112233' }), { origin: null })).status).toBe(200);
  });

  it('answers CORS preflight only for allowed origins', async () => {
    const { app } = setup();
    const preflight = (origin: string) =>
      app.request('/lead', { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } });

    expect((await preflight(SITE)).headers.get('access-control-allow-origin')).toBe(SITE);
    expect((await preflight('https://evil.example')).headers.get('access-control-allow-origin')).toBeNull();
  });

  it('ignores a double submit of the same lead', async () => {
    const { post, notifier, advance } = setup();
    await post(lead());
    advance(2_000);
    expect((await post(lead())).status).toBe(200);
    expect(notifier.sent).toHaveLength(1);

    advance(61_000);
    await post(lead());
    expect(notifier.sent).toHaveLength(2);
  });

  it('rate-limits per IP and says when to retry', async () => {
    const { post, notifier } = setup({ rateLimit: { limit: 2, windowMs: 60_000 } });
    await post(lead({ phone: '0501111111' }));
    await post(lead({ phone: '0502222222' }));
    const blocked = await post(lead({ phone: '0503333333' }));

    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBe('60');
    expect(notifier.sent).toHaveLength(2);
    expect((await post(lead({ phone: '0503333333' }), { headers: { 'x-test-ip': '10.0.0.2' } })).status).toBe(200);
  });

  it('reports delivery failures and lets the visitor retry', async () => {
    const { post, notifier } = setup();
    notifier.failWith = new Error('Telegram is down');
    const failed = await post(lead());
    expect(failed.status).toBe(502);
    expect((await failed.json()).message).toBe(messages.uk.errors.deliveryFailed);

    notifier.failWith = undefined;
    expect((await post(lead())).status).toBe(200);
    expect(notifier.sent).toHaveLength(1);
  });

  it('works as a plain HTML form without JavaScript', async () => {
    const { post, notifier } = setup();
    const body = 'name=%D0%9E%D0%BB%D0%B5%D0%BD%D0%B0&phone=0671234567&extras=Coffee&extras=Tea';
    const response = await post(body, { form: true, headers: { referer: `${SITE}/catering` } });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    const html = await response.text();
    expect(html).toContain(messages.uk.result.thanksTitle);
    expect(html).toContain(`href="${SITE}/catering"`);
    expect(notifier.sent[0]).toContain('Extras: Coffee, Tea');
  });

  it('redirects plain form posts when SUCCESS_REDIRECT is set', async () => {
    const { post } = setup({ successRedirect: `${SITE}/thanks` });
    const response = await post({ phone: '0671234567' }, { form: true });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${SITE}/thanks`);
  });

  it('shows an error page for invalid plain form posts', async () => {
    const { post } = setup({ locale: 'en' });
    const response = await post({ name: 'No contact' }, { form: true, headers: { referer: 'https://elsewhere.example/' } });
    expect(response.status).toBe(422);
    const html = await response.text();
    expect(html).toContain(messages.en.errors.contactRequired);
    expect(html).not.toContain('elsewhere.example'); // never link back to a site we do not trust
  });

  it('rejects malformed, unsupported and oversized bodies', async () => {
    const { post, app } = setup();
    expect((await post('{not json')).status).toBe(400);
    expect((await post('[1,2]')).status).toBe(400);
    expect((await app.request('/lead', { method: 'POST', headers: { 'content-type': 'text/plain', origin: SITE }, body: 'hi' })).status).toBe(400);
    expect((await post({ phone: '0671234567', message: 'x'.repeat(20_000) })).status).toBe(413);
  });
});

describe('other routes', () => {
  it('serves health, the widget and JSON 404s', async () => {
    const { app } = setup();
    expect(await (await app.request('/health')).json()).toEqual({ ok: true });

    const widget = await app.request('/leadgram.js');
    expect(widget.headers.get('content-type')).toContain('text/javascript');
    expect(await widget.text()).toBe('window.Leadgram={}');

    expect((await app.request('/demo')).status).toBe(404);
    expect(await (await app.request('/nope')).json()).toEqual({ ok: false, error: 'not_found' });
  });
});

describe('proxyAwareIp', () => {
  const context = (headers: Record<string, string>) => ({ req: { header: (name: string) => headers[name] } }) as unknown as Context;

  it('uses X-Forwarded-For only behind a trusted proxy', () => {
    const headers = { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' };
    expect(proxyAwareIp(true, () => '10.0.0.1')(context(headers))).toBe('203.0.113.7');
    expect(proxyAwareIp(false, () => '10.0.0.1')(context(headers))).toBe('10.0.0.1');
    expect(proxyAwareIp(false, () => undefined)(context({}))).toBe('unknown');
  });
});

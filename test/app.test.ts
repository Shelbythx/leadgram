import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import type { Config } from '../src/config.ts';
import { TEXTS } from '../src/i18n.ts';
import { silentLogger } from '../src/log.ts';
import { FakeDestination, testConfig } from './helpers.ts';

const START = 1_000_000;
const SITE = 'https://cafe.example';

interface PostOptions {
  asForm?: boolean;
  origin?: string | null;
  headers?: Record<string, string>;
}

function setup(overrides: Partial<Config> = {}) {
  const destination = new FakeDestination();
  let time = START;
  const app = createApp({
    config: testConfig(overrides),
    destinations: [destination],
    clientIp: (c) => c.req.header('x-test-ip') ?? '10.0.0.1',
    logger: silentLogger,
    now: () => time,
    widgetScript: 'window.Leadgram={}',
  });

  const post = (body: Record<string, string> | string, { asForm = false, origin = SITE, headers = {} }: PostOptions = {}) => {
    const requestHeaders: Record<string, string> = {
      'content-type': asForm ? 'application/x-www-form-urlencoded' : 'application/json',
      accept: asForm ? 'text/html' : 'application/json',
      ...(origin ? { origin } : {}),
      ...headers,
    };
    const payload = typeof body === 'string' ? body : asForm ? new URLSearchParams(body).toString() : JSON.stringify(body);
    return app.request('/lead', { method: 'POST', headers: requestHeaders, body: payload });
  };

  return { app, destination, post, advanceTime: (ms: number) => (time += ms) };
}

const widgetLead = (fields: Record<string, string> = {}) => ({ name: 'Олена', phone: '067 123 45 67', _t: String(START - 10_000), ...fields });

describe('POST /lead', () => {
  it('delivers a valid lead', async () => {
    const { post, destination } = setup();
    const response = await post(widgetLead({ guests: '20–50' }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(destination.leads).toEqual([{ name: 'Олена', phone: '+380671234567', extra: [['guests', '20–50']], page: undefined }]);
  });

  it('returns field errors for invalid input', async () => {
    const { post, destination } = setup();
    const response = await post({ name: 'Олена', phone: 'nope' });

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      ok: false,
      error: 'validation',
      message: TEXTS.uk.errors.invalidPhone,
      fields: { phone: TEXTS.uk.errors.invalidPhone },
    });
    expect(destination.leads).toHaveLength(0);
  });

  it('pretends to accept spam but does not deliver it', async () => {
    const { post, destination } = setup();
    const honeypot = await post(widgetLead({ _gotcha: 'filled by a bot' }));
    const tooFast = await post(widgetLead({ _t: String(START - 500) }));

    expect(honeypot.status).toBe(200);
    expect(tooFast.status).toBe(200);
    expect(destination.leads).toHaveLength(0);
  });

  it('rejects other origins but allows its own origin and requests without one', async () => {
    const { post } = setup();
    const foreign = await post(widgetLead(), { origin: 'https://evil.example' });
    expect(foreign.status).toBe(403);
    expect((await foreign.json()).error).toBe('forbidden_origin');

    expect((await post(widgetLead(), { origin: 'http://localhost' })).status).toBe(200);
    expect((await post(widgetLead({ phone: '0501112233' }), { origin: null })).status).toBe(200);
  });

  it('answers CORS preflight only for allowed origins', async () => {
    const { app } = setup();
    const preflight = (origin: string) =>
      app.request('/lead', {
        method: 'OPTIONS',
        headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' },
      });

    expect((await preflight(SITE)).headers.get('access-control-allow-origin')).toBe(SITE);
    expect((await preflight('https://evil.example')).headers.get('access-control-allow-origin')).toBeNull();
  });

  it('ignores a double submit of the same lead within a minute', async () => {
    const { post, destination, advanceTime } = setup();
    await post(widgetLead());
    advanceTime(2_000);
    expect((await post(widgetLead())).status).toBe(200);
    expect(destination.leads).toHaveLength(1);

    advanceTime(61_000);
    await post(widgetLead());
    expect(destination.leads).toHaveLength(2);
  });

  it('rate-limits per IP and says when to retry', async () => {
    const { post, destination } = setup({ rateLimit: { limit: 2, windowMs: 60_000 } });
    await post(widgetLead({ phone: '0501111111' }));
    await post(widgetLead({ phone: '0502222222' }));
    const blocked = await post(widgetLead({ phone: '0503333333' }));

    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBe('60');
    expect(destination.leads).toHaveLength(2);
    expect((await post(widgetLead({ phone: '0503333333' }), { headers: { 'x-test-ip': '10.0.0.2' } })).status).toBe(200);
  });

  it('reports delivery failures and lets the visitor retry', async () => {
    const { post, destination } = setup();
    destination.failWith = new Error('Telegram is down');
    const failed = await post(widgetLead());
    expect(failed.status).toBe(502);
    expect((await failed.json()).message).toBe(TEXTS.uk.errors.deliveryFailed);

    destination.failWith = undefined;
    expect((await post(widgetLead())).status).toBe(200);
    expect(destination.leads).toHaveLength(1);
  });

  it('works as a plain HTML form without JavaScript', async () => {
    const { post, destination } = setup();
    const body = 'name=%D0%9E%D0%BB%D0%B5%D0%BD%D0%B0&phone=0671234567&extras=Coffee&extras=Tea';
    const response = await post(body, { asForm: true, headers: { referer: `${SITE}/catering` } });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    const html = await response.text();
    expect(html).toContain(TEXTS.uk.resultPage.thanksTitle);
    expect(html).toContain(`href="${SITE}/catering"`);
    expect(destination.leads[0]).toMatchObject({ extra: [['extras', 'Coffee, Tea']], page: `${SITE}/catering` });
  });

  it('redirects plain form posts when SUCCESS_REDIRECT is set', async () => {
    const { post } = setup({ successRedirect: `${SITE}/thanks` });
    const response = await post({ phone: '0671234567' }, { asForm: true });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${SITE}/thanks`);
  });

  it('shows an error page for invalid plain form posts', async () => {
    const { post } = setup({ locale: 'en' });
    const response = await post({ name: 'No contact' }, { asForm: true });

    expect(response.status).toBe(422);
    expect(await response.text()).toContain(TEXTS.en.errors.contactRequired);
  });

  it('never links back to an untrusted referer', async () => {
    const { post } = setup();
    const response = await post({ name: 'No contact' }, { asForm: true, headers: { referer: 'https://elsewhere.example/' } });
    expect(await response.text()).not.toContain('elsewhere.example');
  });

  it('rejects unreadable and oversized bodies', async () => {
    const { post } = setup();
    expect((await post('{not json')).status).toBe(400);
    expect((await post({ phone: '0671234567', message: 'x'.repeat(20_000) })).status).toBe(413);
  });
});

describe('other routes', () => {
  it('serves health, the widget and JSON 404s', async () => {
    const { app } = setup();
    expect(await (await app.request('/health')).json()).toEqual({ ok: true });

    const widget = await app.request('/leadgram.js');
    expect(widget.headers.get('content-type')).toContain('text/javascript');
    expect(widget.headers.get('cache-control')).toBe('public, max-age=3600');
    expect(await widget.text()).toBe('window.Leadgram={}');

    expect((await app.request('/demo')).status).toBe(404);
    expect(await (await app.request('/nope')).json()).toEqual({ ok: false, error: 'not_found' });
  });
});

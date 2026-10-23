import { type Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Config } from './config.ts';
import { formatLead } from './format.ts';
import { messages } from './i18n.ts';
import { createLeadSchema, type Fields, parseLead } from './lead.ts';
import { createLogger, type Logger } from './log.ts';
import { resultPage } from './pages.ts';
import { RateLimiter, RecentLeads } from './rate-limit.ts';
import { checkSpam } from './spam.ts';
import type { Notifier } from './telegram.ts';

export interface AppDeps {
  config: Config;
  notifier: Notifier;
  /** How to find the visitor's IP; differs between Node, proxies and tests. */
  clientIp: (c: Context) => string;
  logger?: Logger;
  now?: () => number;
  /** Built widget served at /leadgram.js. */
  widgetScript?: string | undefined;
  /** Example page served at /demo when DEMO_PAGE=true. */
  demoHtml?: string | undefined;
}

const MAX_BODY_BYTES = 16 * 1024;
const MAX_FIELDS = 50;
const DUPLICATE_WINDOW_MS = 60_000;

type ErrorCode = 'validation' | 'bad_request' | 'forbidden_origin' | 'payload_too_large' | 'rate_limited' | 'delivery_failed';

/** Reads the client IP, honouring X-Forwarded-For only behind a trusted proxy. */
export function proxyAwareIp(trustProxy: boolean, fallback: (c: Context) => string | undefined) {
  return (c: Context): string => {
    if (trustProxy) {
      const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip');
      if (forwarded) return forwarded;
    }
    return fallback(c) ?? 'unknown';
  };
}

function toFields(entries: Array<[string, unknown]>): Fields {
  const fields: Fields = {};
  for (const [key, raw] of entries.slice(0, MAX_FIELDS)) {
    const values = (Array.isArray(raw) ? raw : [raw])
      .filter((value) => ['string', 'number', 'boolean'].includes(typeof value))
      .map(String);
    // Checkbox groups (several values under one name) become "a, b"
    if (values.length) fields[key.slice(0, 64)] = values.join(', ');
  }
  return fields;
}

async function readFields(c: Context): Promise<Fields | null> {
  const type = c.req.header('content-type') ?? '';
  try {
    if (type.includes('application/json')) {
      const body: unknown = await c.req.json();
      if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
      return toFields(Object.entries(body));
    }
    if (type.includes('application/x-www-form-urlencoded') || type.includes('multipart/form-data')) {
      return toFields(Object.entries(await c.req.parseBody({ all: true })));
    }
  } catch {
    // malformed JSON or form data
  }
  return null;
}

export function createApp(deps: AppDeps) {
  const { config, notifier } = deps;
  const t = messages[config.locale];
  const schema = createLeadSchema(t);
  const limiter = new RateLimiter(config.rateLimit.limit, config.rateLimit.windowMs);
  const recent = new RecentLeads(DUPLICATE_WINDOW_MS);
  const now = deps.now ?? Date.now;
  const log = deps.logger ?? createLogger();

  const isAllowedOrigin = (origin: string, c: Context) =>
    config.allowedOrigins.includes('*') || config.allowedOrigins.includes(origin) || origin === new URL(c.req.url).origin;

  const wantsJson = (c: Context) =>
    (c.req.header('accept') ?? '').includes('application/json') || (c.req.header('content-type') ?? '').includes('application/json');

  /** Where the "back to the website" link on the no-JS result page points. */
  const backHref = (c: Context) => {
    const referer = c.req.header('referer');
    if (!referer || !URL.canParse(referer)) return undefined;
    return isAllowedOrigin(new URL(referer).origin, c) ? referer : undefined;
  };

  const fail = (c: Context, status: ContentfulStatusCode, error: ErrorCode, message: string, fields?: Record<string, string>) => {
    if (wantsJson(c)) return c.json({ ok: false, error, message, ...(fields ? { fields } : {}) }, status);
    const page = { ok: false, title: t.result.errorTitle, text: message, backHref: backHref(c), backLabel: t.result.back };
    return c.html(resultPage(config.locale, page), status);
  };

  const succeed = (c: Context) => {
    if (wantsJson(c)) return c.json({ ok: true });
    if (config.successRedirect) return c.redirect(config.successRedirect, 303);
    const page = { ok: true, title: t.result.thanksTitle, text: t.result.thanksBody, backHref: backHref(c), backLabel: t.result.back };
    return c.html(resultPage(config.locale, page));
  };

  const app = new Hono();

  app.use(
    '/lead',
    cors({
      origin: (origin, c) => (isAllowedOrigin(origin, c) ? origin : null),
      allowMethods: ['POST'],
      allowHeaders: ['Content-Type', 'Accept'],
      maxAge: 86_400,
    }),
  );

  app.post(
    '/lead',
    bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => fail(c, 413, 'payload_too_large', t.errors.payloadTooLarge) }),
    async (c) => {
      const origin = c.req.header('origin');
      if (origin && !isAllowedOrigin(origin, c)) {
        log.warn('lead.rejected', { reason: 'origin', origin });
        return fail(c, 403, 'forbidden_origin', t.errors.forbiddenOrigin);
      }

      const fields = await readFields(c);
      if (!fields) return fail(c, 400, 'bad_request', t.errors.badRequest);

      // Bots get the same success response as people, so they learn nothing.
      const verdict = checkSpam(fields, { now: now(), minFillMs: config.minFillMs, maxLinks: config.maxLinks });
      if (verdict.spam) {
        log.info('lead.spam', { reason: verdict.reason, origin });
        return succeed(c);
      }

      const parsed = parseLead(fields, schema);
      if (!parsed.ok) {
        return fail(c, 422, 'validation', Object.values(parsed.fields)[0] ?? t.errors.badRequest, parsed.fields);
      }
      const lead = { ...parsed.lead, page: fields._page || c.req.header('referer') };

      const ip = deps.clientIp(c);
      const key = RecentLeads.key([ip, lead.phone, lead.email, lead.message]);
      if (recent.isDuplicate(key, now())) {
        log.info('lead.duplicate', { origin });
        return succeed(c);
      }

      const rate = limiter.hit(ip, now());
      if (!rate.allowed) {
        recent.forget(key);
        c.header('Retry-After', String(rate.retryAfterSeconds));
        log.warn('lead.rate_limited', { origin, retryAfter: rate.retryAfterSeconds });
        return fail(c, 429, 'rate_limited', t.errors.rateLimited);
      }

      try {
        const text = formatLead(lead, { t, locale: config.locale, timeZone: config.timeZone, receivedAt: new Date(now()) });
        const result = await notifier.send(text);
        log.info('lead.sent', { origin, form: lead.form, delivered: result.delivered, failed: result.failed.length });
        for (const reason of result.failed) log.warn('telegram.partial_failure', { reason });
      } catch (error) {
        // Let the visitor retry instead of treating the retry as a duplicate.
        recent.forget(key);
        log.error('lead.delivery_failed', { origin, reason: (error as Error).message });
        return fail(c, 502, 'delivery_failed', t.errors.deliveryFailed);
      }

      return succeed(c);
    },
  );

  app.get('/health', (c) => c.json({ ok: true }));

  if (deps.widgetScript) {
    const script = deps.widgetScript;
    app.get('/leadgram.js', (c) => {
      c.header('Content-Type', 'text/javascript; charset=utf-8');
      c.header('Cache-Control', 'public, max-age=3600');
      return c.body(script);
    });
  }

  if (config.demoPage && deps.demoHtml) {
    const demo = deps.demoHtml;
    app.get('/demo', (c) => c.html(demo));
  }

  app.get('/', (c) => c.text('leadgram is running. Send leads with POST /lead.\n'));
  app.notFound((c) => c.json({ ok: false, error: 'not_found' }, 404));
  app.onError((error, c) => {
    log.error('unhandled', { message: error.message });
    return c.json({ ok: false, error: 'internal' }, 500);
  });

  return app;
}

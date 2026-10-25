import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Config } from './config.ts';
import type { Destination } from './delivery/destination.ts';
import { limitBodySize } from './http/body-limit.ts';
import { createLeadHandler } from './http/lead-route.ts';
import { createOriginPolicy } from './http/origin-policy.ts';
import type { ClientIpResolver } from './http/request.ts';
import { createResponder } from './http/responder.ts';
import { TEXTS } from './i18n.ts';
import { createLogger, type Logger } from './log.ts';

export interface AppDeps {
  config: Config;
  destinations: readonly Destination[];
  clientIp: ClientIpResolver;
  logger?: Logger;
  now?: () => number;
  widgetScript?: string | undefined;
  demoHtml?: string | undefined;
}

const PREFLIGHT_CACHE_SECONDS = 86_400;
const WIDGET_CACHE_SECONDS = 3_600;

export function createApp({ config, destinations, clientIp, logger, now = Date.now, widgetScript, demoHtml }: AppDeps): Hono {
  const log = logger ?? createLogger();
  const origins = createOriginPolicy(config.allowedOrigins);
  const respond = createResponder({
    locale: config.locale,
    texts: TEXTS[config.locale],
    successRedirect: config.successRedirect,
    backLinkFor: (c) => origins.trustedReferer(c.req),
  });

  const app = new Hono();

  app.use(
    '/lead',
    cors({
      origin: (origin, c) => (origins.isAllowed(origin, c.req) ? origin : null),
      allowMethods: ['POST'],
      allowHeaders: ['Content-Type', 'Accept'],
      maxAge: PREFLIGHT_CACHE_SECONDS,
    }),
  );
  app.post(
    '/lead',
    limitBodySize(config.attachments, (c) => respond.reject(c, 'payload_too_large')),
    createLeadHandler({ config, destinations, clientIp, origins, respond, log, now }),
  );

  app.get('/health', (c) => c.json({ ok: true }));
  if (widgetScript) serveWidget(app, widgetScript);
  if (demoHtml) app.get('/demo', (c) => c.html(demoHtml));
  app.get('/', (c) => c.text('leadgram is running. Send leads with POST /lead.\n'));

  app.notFound((c) => c.json({ ok: false, error: 'not_found' }, 404));
  app.onError((error, c) => {
    log.error('unhandled', { message: error.message });
    return c.json({ ok: false, error: 'internal' }, 500);
  });

  return app;
}

function serveWidget(app: Hono, script: string): void {
  app.get('/leadgram.js', (c) => {
    c.header('Content-Type', 'text/javascript; charset=utf-8');
    c.header('Cache-Control', `public, max-age=${WIDGET_CACHE_SECONDS}`);
    return c.body(script);
  });
}

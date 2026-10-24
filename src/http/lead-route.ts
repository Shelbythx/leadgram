import type { Context } from 'hono';
import type { Config } from '../config.ts';
import { errorMessage } from '../errors.ts';
import { TEXTS } from '../i18n.ts';
import { createLeadSchema, type Lead, parseLead } from '../lead/lead.ts';
import { renderLeadMessage } from '../lead/message.ts';
import type { Logger } from '../log.ts';
import { DuplicateGuard, fingerprint } from '../protection/duplicate-guard.ts';
import { RateLimiter } from '../protection/rate-limiter.ts';
import { detectSpam } from '../protection/spam-filter.ts';
import type { Notifier } from '../telegram.ts';
import type { OriginPolicy } from './origin-policy.ts';
import { type ClientIpResolver, readFormFields } from './request.ts';
import type { Responder } from './responder.ts';

export interface LeadRouteDeps {
  config: Config;
  notifier: Notifier;
  clientIp: ClientIpResolver;
  origins: OriginPolicy;
  respond: Responder;
  log: Logger;
  now: () => number;
}

const DUPLICATE_WINDOW_MS = 60_000;

export function createLeadHandler({ config, notifier, clientIp, origins, respond, log, now }: LeadRouteDeps) {
  const texts = TEXTS[config.locale];
  const schema = createLeadSchema(texts);
  const rateLimiter = new RateLimiter(config.rateLimit);
  const duplicates = new DuplicateGuard(DUPLICATE_WINDOW_MS);
  const spamRules = { minFillMs: config.minFillMs, maxLinks: config.maxLinks };

  const ignoreSilently = (c: Context) => respond.accept(c);

  async function deliver(lead: Lead, origin: string | undefined): Promise<boolean> {
    const message = renderLeadMessage(lead, { texts, locale: config.locale, timeZone: config.timeZone, receivedAt: new Date(now()) });
    try {
      const result = await notifier.send(message);
      log.info('lead.sent', { origin, form: lead.formName, delivered: result.delivered, failed: result.failed.length });
      for (const reason of result.failed) log.warn('telegram.partial_failure', { reason });
      return true;
    } catch (error) {
      log.error('lead.delivery_failed', { origin, reason: errorMessage(error) });
      return false;
    }
  }

  return async (c: Context) => {
    const origin = c.req.header('origin');
    if (origin && !origins.isAllowed(origin, c.req)) {
      log.warn('lead.rejected', { reason: 'origin', origin });
      return respond.reject(c, 'forbidden_origin');
    }

    const fields = await readFormFields(c.req);
    if (!fields) return respond.reject(c, 'bad_request');

    const spamReason = detectSpam(fields, spamRules, now());
    if (spamReason) {
      log.info('lead.spam', { reason: spamReason, origin });
      return ignoreSilently(c);
    }

    const parsed = parseLead(fields, schema);
    if (!parsed.ok) return respond.invalid(c, parsed.errors);

    const lead = { ...parsed.lead, page: parsed.lead.page ?? c.req.header('referer') };
    const visitorIp = clientIp(c);
    const leadKey = fingerprint(visitorIp, lead.phone, lead.email, lead.message);

    if (duplicates.has(leadKey, now())) {
      log.info('lead.duplicate', { origin });
      return ignoreSilently(c);
    }

    const quota = rateLimiter.consume(visitorIp, now());
    if (!quota.allowed) {
      log.warn('lead.rate_limited', { origin, retryAfter: quota.retryAfterSeconds });
      return respond.rateLimited(c, quota.retryAfterSeconds);
    }

    duplicates.remember(leadKey, now());
    if (await deliver(lead, origin)) return respond.accept(c);

    duplicates.forget(leadKey);
    return respond.reject(c, 'delivery_failed');
  };
}

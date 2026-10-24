import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Locale, LocaleTexts } from '../i18n.ts';
import type { FieldErrors } from '../lead/lead.ts';
import { prefersJson } from './request.ts';
import { type ResultPage, renderResultPage } from './result-page.ts';

export type Rejection = 'bad_request' | 'forbidden_origin' | 'payload_too_large' | 'rate_limited' | 'delivery_failed';

export type Responder = ReturnType<typeof createResponder>;

export interface ResponderOptions {
  locale: Locale;
  texts: LocaleTexts;
  successRedirect?: string | undefined;
  backLinkFor: (c: Context) => string | undefined;
}

const REJECTIONS: Record<Rejection, { status: ContentfulStatusCode; message: keyof LocaleTexts['errors'] }> = {
  bad_request: { status: 400, message: 'badRequest' },
  forbidden_origin: { status: 403, message: 'forbiddenOrigin' },
  payload_too_large: { status: 413, message: 'payloadTooLarge' },
  rate_limited: { status: 429, message: 'rateLimited' },
  delivery_failed: { status: 502, message: 'deliveryFailed' },
};

const VALIDATION_STATUS = 422;
const SEE_OTHER = 303;

export function createResponder({ locale, texts, successRedirect, backLinkFor }: ResponderOptions) {
  function page(c: Context, status: ContentfulStatusCode, content: Omit<ResultPage, 'backLink'>) {
    const href = backLinkFor(c);
    const backLink = href ? { href, label: texts.resultPage.backToSite } : undefined;
    return c.html(renderResultPage(locale, { ...content, backLink }), status);
  }

  function failure(c: Context, status: ContentfulStatusCode, error: string, message: string, fields?: FieldErrors) {
    if (prefersJson(c.req)) return c.json({ ok: false, error, message, ...(fields && { fields }) }, status);
    return page(c, status, { tone: 'error', title: texts.resultPage.errorTitle, message });
  }

  function accept(c: Context) {
    if (prefersJson(c.req)) return c.json({ ok: true });
    if (successRedirect) return c.redirect(successRedirect, SEE_OTHER);
    return page(c, 200, { tone: 'success', title: texts.resultPage.thanksTitle, message: texts.resultPage.thanksBody });
  }

  function reject(c: Context, rejection: Rejection) {
    const { status, message } = REJECTIONS[rejection];
    return failure(c, status, rejection, texts.errors[message]);
  }

  function rateLimited(c: Context, retryAfterSeconds: number) {
    c.header('Retry-After', String(retryAfterSeconds));
    return reject(c, 'rate_limited');
  }

  function invalid(c: Context, errors: FieldErrors) {
    const [firstError = texts.errors.badRequest] = Object.values(errors);
    return failure(c, VALIDATION_STATUS, 'validation', firstError, errors);
  }

  return { accept, reject, rateLimited, invalid };
}

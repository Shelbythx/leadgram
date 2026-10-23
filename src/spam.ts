import type { Fields } from './lead.ts';

export type SpamVerdict = { spam: false } | { spam: true; reason: 'honeypot' | 'too_fast' | 'too_many_links' };

export interface SpamOptions {
  now: number;
  /** Humans need a few seconds to fill a form; bots post instantly. */
  minFillMs: number;
  /** More links than this in the text fields looks like SEO spam. */
  maxLinks: number;
}

/** Name of the hidden field that people never see but naive bots fill in. */
export const HONEYPOT_FIELD = '_gotcha';
/** Timestamp (ms) set by the widget when the form was rendered. */
export const RENDERED_AT_FIELD = '_t';

const LINK = /\bhttps?:\/\/|\bwww\.|\[url=|<a\s/gi;

export function checkSpam(fields: Fields, options: SpamOptions): SpamVerdict {
  if (fields[HONEYPOT_FIELD]?.trim()) return { spam: true, reason: 'honeypot' };

  // Without the widget (plain HTML form, JS disabled) there is no timestamp,
  // so the check is skipped rather than punishing those visitors.
  const renderedAt = Number(fields[RENDERED_AT_FIELD]);
  if (Number.isFinite(renderedAt) && renderedAt > 0 && renderedAt <= options.now) {
    if (options.now - renderedAt < options.minFillMs) return { spam: true, reason: 'too_fast' };
  }

  const text = Object.entries(fields)
    .filter(([key]) => !key.startsWith('_'))
    .map(([, value]) => value)
    .join(' ');
  const links = text.match(LINK)?.length ?? 0;
  if (links > options.maxLinks) return { spam: true, reason: 'too_many_links' };

  return { spam: false };
}

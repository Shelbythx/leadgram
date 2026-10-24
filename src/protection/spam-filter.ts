import { type FormFields, isServiceField, SERVICE_FIELD } from '../lead/fields.ts';

export type SpamReason = 'honeypot' | 'too_fast' | 'too_many_links';

export interface SpamRules {
  minFillMs: number;
  maxLinks: number;
}

const LINK = /\bhttps?:\/\/|\bwww\.|\[url=|<a\s/gi;

export function detectSpam(fields: FormFields, rules: SpamRules, now: number): SpamReason | undefined {
  if (isHoneypotFilled(fields)) return 'honeypot';
  if (wasFilledTooFast(fields, rules.minFillMs, now)) return 'too_fast';
  if (countLinks(visibleText(fields)) > rules.maxLinks) return 'too_many_links';
  return undefined;
}

function isHoneypotFilled(fields: FormFields): boolean {
  return Boolean(fields[SERVICE_FIELD.honeypot]?.trim());
}

function wasFilledTooFast(fields: FormFields, minFillMs: number, now: number): boolean {
  const renderedAt = Number(fields[SERVICE_FIELD.renderedAt]);
  const hasPlausibleRenderTime = Number.isFinite(renderedAt) && renderedAt > 0 && renderedAt <= now;
  return hasPlausibleRenderTime && now - renderedAt < minFillMs;
}

function visibleText(fields: FormFields): string {
  return Object.entries(fields)
    .filter(([name]) => !isServiceField(name))
    .map(([, value]) => value)
    .join(' ');
}

function countLinks(text: string): number {
  return text.match(LINK)?.length ?? 0;
}

import type { Locale, Messages } from './i18n.ts';
import type { Lead } from './lead.ts';

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** `preferred_time` / `preferredTime` → `Preferred time` */
export function humanizeKey(key: string): string {
  const words = key
    .replace(/([a-zа-яіїєґ])([A-ZА-ЯІЇЄҐ])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function parseHttpUrl(value: string | undefined): URL | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
}

export interface FormatContext {
  t: Messages;
  locale: Locale;
  timeZone: string;
  receivedAt: Date;
}

/** Builds the Telegram message (HTML parse mode). Every user value is escaped. */
export function formatLead(lead: Lead, { t, locale, timeZone, receivedAt }: FormatContext): string {
  const lines: string[] = [];
  const title = `🆕 <b>${t.newLead}</b>`;
  lines.push(lead.form ? `${title} · ${escapeHtml(lead.form)}` : title, '');

  if (lead.name) lines.push(`👤 ${t.name}: <b>${escapeHtml(lead.name)}</b>`);
  // Kept as plain text so Telegram turns it into a tappable number.
  if (lead.phone) lines.push(`📞 ${t.phone}: ${escapeHtml(lead.phone)}`);
  if (lead.email) lines.push(`✉️ ${t.email}: ${escapeHtml(lead.email)}`);
  if (lead.message) lines.push(`💬 ${t.message}:`, `<blockquote>${escapeHtml(lead.message)}</blockquote>`);

  if (lead.extra.length) {
    lines.push('');
    for (const [key, value] of lead.extra) lines.push(`▫️ ${escapeHtml(humanizeKey(key))}: ${escapeHtml(value)}`);
  }

  lines.push('');
  const page = parseHttpUrl(lead.page);
  if (page) {
    const label = `${page.host}${page.pathname === '/' ? '' : page.pathname}`;
    lines.push(`🌐 ${t.page}: <a href="${escapeHtml(page.href)}">${escapeHtml(label.slice(0, 80))}</a>`);

    const utm = ['source', 'medium', 'campaign', 'term', 'content']
      .map((name) => [name, page.searchParams.get(`utm_${name}`)] as const)
      .filter(([, value]) => value)
      .map(([name, value]) => `${name}=${escapeHtml(value!.slice(0, 60))}`);
    if (utm.length) lines.push(`📊 UTM: ${utm.join(' · ')}`);
  }

  const time = new Intl.DateTimeFormat(locale === 'uk' ? 'uk-UA' : 'en-GB', {
    timeZone,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(receivedAt);
  lines.push(`🕒 ${t.received}: ${time}`);

  return lines.join('\n');
}

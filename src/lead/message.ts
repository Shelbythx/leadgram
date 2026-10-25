import { escapeHtml } from '../html.ts';
import type { Locale, LocaleTexts } from '../i18n.ts';
import type { ExtraField, Lead } from './lead.ts';
import { parseWebUrl, utmParameters } from './source.ts';

export interface MessageFormat {
  texts: LocaleTexts;
  locale: Locale;
  timeZone: string;
}

export interface MessageContext extends MessageFormat {
  receivedAt: Date;
}

const MAX_PAGE_LABEL_LENGTH = 80;
const MAX_UTM_VALUE_LENGTH = 60;
const DATE_FORMAT_LOCALE: Record<Locale, string> = { uk: 'uk-UA', en: 'en-GB' };

export function renderLeadMessage(lead: Lead, context: MessageContext): string {
  const sections = [
    [titleLine(lead.formName, context.texts)],
    contactLines(lead, context.texts),
    [...extraFieldLines(lead.extra), ...fileCountLines(lead.attachments.length, context.texts)],
    [...sourceLines(lead.page, context.texts), receivedLine(context)],
  ];
  return sections
    .filter((lines) => lines.length > 0)
    .map((lines) => lines.join('\n'))
    .join('\n\n');
}

export function humanizeFieldName(name: string): string {
  const words = name
    .replace(/([a-zа-яіїєґ])([A-ZА-ЯІЇЄҐ])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function titleLine(formName: string | undefined, texts: LocaleTexts): string {
  const title = `🆕 <b>${texts.newLead}</b>`;
  return formName ? `${title} · ${escapeHtml(formName)}` : title;
}

function contactLines(lead: Lead, texts: LocaleTexts): string[] {
  const lines: string[] = [];
  if (lead.name) lines.push(`👤 ${texts.name}: <b>${escapeHtml(lead.name)}</b>`);
  if (lead.phone) lines.push(`📞 ${texts.phone}: ${escapeHtml(lead.phone)}`);
  if (lead.email) lines.push(`✉️ ${texts.email}: ${escapeHtml(lead.email)}`);
  if (lead.message) lines.push(`💬 ${texts.message}:`, `<blockquote>${escapeHtml(lead.message)}</blockquote>`);
  return lines;
}

function extraFieldLines(extra: ExtraField[]): string[] {
  return extra.map(([name, value]) => `▫️ ${escapeHtml(humanizeFieldName(name))}: ${escapeHtml(value)}`);
}

function fileCountLines(count: number, texts: LocaleTexts): string[] {
  return count > 0 ? [`📎 ${texts.files}: ${count}`] : [];
}

function sourceLines(page: string | undefined, texts: LocaleTexts): string[] {
  const url = parseWebUrl(page);
  if (!url) return [];

  const lines = [`🌐 ${texts.page}: <a href="${escapeHtml(url.href)}">${escapeHtml(pageLabel(url))}</a>`];
  const utm = utmSummary(url);
  if (utm) lines.push(`📊 UTM: ${utm}`);
  return lines;
}

function pageLabel(url: URL): string {
  const path = url.pathname === '/' ? '' : url.pathname;
  return `${url.host}${path}`.slice(0, MAX_PAGE_LABEL_LENGTH);
}

function utmSummary(url: URL): string {
  return Object.entries(utmParameters(url))
    .map(([name, value]) => `${name}=${escapeHtml(value.slice(0, MAX_UTM_VALUE_LENGTH))}`)
    .join(' · ');
}

function receivedLine({ texts, locale, timeZone, receivedAt }: MessageContext): string {
  const time = new Intl.DateTimeFormat(DATE_FORMAT_LOCALE[locale], { timeZone, dateStyle: 'short', timeStyle: 'short' }).format(receivedAt);
  return `🕒 ${texts.received}: ${time}`;
}

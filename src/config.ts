import * as z from 'zod';
import type { Locale } from './i18n.ts';
import type { ChatTarget } from './telegram.ts';

export interface Config {
  telegramToken: string;
  /** Bot API base URL; change only for a self-hosted Bot API server. */
  telegramApiUrl: string;
  chats: ChatTarget[];
  /** Allowed site origins, or ['*'] for any. */
  allowedOrigins: string[];
  port: number;
  host: string;
  locale: Locale;
  timeZone: string;
  rateLimit: { limit: number; windowMs: number };
  minFillMs: number;
  maxLinks: number;
  successRedirect?: string | undefined;
  trustProxy: boolean;
  demoPage: boolean;
}

const UNITS = { s: 1_000, m: 60_000, h: 3_600_000 } as const;

/** "5/10m" → 5 requests per 10 minutes */
export function parseRate(value: string): { limit: number; windowMs: number } | undefined {
  const match = /^(\d+)\s*\/\s*(\d*)\s*([smh])$/.exec(value.trim());
  if (!match) return undefined;
  const limit = Number(match[1]);
  const amount = match[2] ? Number(match[2]) : 1;
  const windowMs = amount * UNITS[match[3] as keyof typeof UNITS];
  return limit > 0 && windowMs > 0 ? { limit, windowMs } : undefined;
}

/** "-100123, -100456:7" → two chats, the second one posting into topic 7 */
export function parseChats(value: string): ChatTarget[] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [chatId = '', thread] = part.split(':');
      return thread ? { chatId, threadId: Number(thread) } : { chatId };
    });
}

function normalizeOrigin(origin: string): string {
  return origin === '*' ? origin : new URL(origin).origin;
}

const isTimeZone = (zone: string) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
};

const EnvSchema = z.object({
  TELEGRAM_BOT_TOKEN: z
    .string({ error: 'is required — create a bot with @BotFather and paste its token' })
    .regex(/^\d+:[\w-]{30,}$/, { error: 'does not look like a bot token (expected 123456:ABC…)' }),
  TELEGRAM_CHAT_IDS: z
    .string({ error: 'is required — run `npm run chat-id` to find yours' })
    .transform(parseChats)
    .refine((chats) => chats.length > 0 && chats.every((c) => /^-?\d+$|^@\w+$/.test(c.chatId) && (c.threadId === undefined || c.threadId > 0)), {
      error: 'must be comma-separated chat ids, e.g. 123456789,-1001234567890 or -1001234567890:42 for a topic',
    }),
  ALLOWED_ORIGINS: z
    .string({ error: 'is required — list your site origins, e.g. https://example.com (or * to allow any)' })
    .transform((value) => value.split(',').map((o) => o.trim()).filter(Boolean))
    .refine((origins) => origins.length > 0 && origins.every((o) => o === '*' || URL.canParse(o)), {
      error: 'must be comma-separated origins like https://example.com,https://www.example.com',
    })
    .transform((origins) => origins.map(normalizeOrigin)),
  TELEGRAM_API_URL: z.url({ protocol: /^https?$/ }).default('https://api.telegram.org'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOCALE: z.enum(['uk', 'en']).default('uk'),
  TIMEZONE: z.string().default('Europe/Kyiv').refine(isTimeZone, { error: 'is not a valid IANA time zone' }),
  RATE_LIMIT: z
    .string()
    .default('5/10m')
    .transform((value, ctx) => {
      const rate = parseRate(value);
      if (!rate) ctx.addIssue({ code: 'custom', message: 'must look like 5/10m (requests per window; s, m or h)' });
      return rate ?? { limit: 0, windowMs: 0 };
    }),
  MIN_FILL_SECONDS: z.coerce.number().min(0).max(60).default(3),
  MAX_LINKS: z.coerce.number().int().min(0).default(2),
  SUCCESS_REDIRECT: z.url({ protocol: /^https?$/ }).optional(),
  TRUST_PROXY: z.stringbool().default(false),
  DEMO_PAGE: z.stringbool().default(false),
});

export class ConfigError extends Error {
  override name = 'ConfigError';
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  // Treat `KEY=` in .env as "not set" so defaults apply.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined && value.trim() !== ''));
  const result = EnvSchema.safeParse(cleaned);
  if (!result.success) {
    const lines = result.error.issues.map((issue) => `  • ${issue.path.join('.')} ${issue.message}`);
    throw new ConfigError(`Invalid configuration:\n${lines.join('\n')}`);
  }

  const parsed = result.data;
  return {
    telegramToken: parsed.TELEGRAM_BOT_TOKEN,
    telegramApiUrl: parsed.TELEGRAM_API_URL.replace(/\/+$/, ''),
    chats: parsed.TELEGRAM_CHAT_IDS,
    allowedOrigins: parsed.ALLOWED_ORIGINS,
    port: parsed.PORT,
    host: parsed.HOST,
    locale: parsed.LOCALE,
    timeZone: parsed.TIMEZONE,
    rateLimit: parsed.RATE_LIMIT,
    minFillMs: parsed.MIN_FILL_SECONDS * 1000,
    maxLinks: parsed.MAX_LINKS,
    successRedirect: parsed.SUCCESS_REDIRECT,
    trustProxy: parsed.TRUST_PROXY,
    demoPage: parsed.DEMO_PAGE,
  };
}

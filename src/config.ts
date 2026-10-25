import * as z from 'zod';
import type { Locale } from './i18n.ts';
import type { RateLimit } from './protection/rate-limiter.ts';
import type { ChatTarget } from './telegram.ts';

export interface Config {
  telegramToken: string;
  telegramApiUrl: string;
  chats: ChatTarget[];
  allowedOrigins: string[];
  port: number;
  host: string;
  locale: Locale;
  timeZone: string;
  rateLimit: RateLimit;
  minFillMs: number;
  maxLinks: number;
  successRedirect?: string | undefined;
  webhook?: WebhookConfig | undefined;
  trustProxy: boolean;
  demoPage: boolean;
}

export interface WebhookConfig {
  url: string;
  secret?: string | undefined;
}

export const ANY_ORIGIN = '*';

const MS_PER_UNIT = { s: 1_000, m: 60_000, h: 3_600_000 } as const;
const RATE_LIMIT_FORMAT = /^(\d+)\s*\/\s*(\d*)\s*([smh])$/;
const CHAT_ID_FORMAT = /^-?\d+$|^@\w+$/;
const BOT_TOKEN_FORMAT = /^\d+:[\w-]{30,}$/;
const WEB_URL = { protocol: /^https?$/ };
const MIN_WEBHOOK_SECRET_LENGTH = 16;

export class ConfigError extends Error {
  override name = 'ConfigError';
}

export function parseRateLimit(value: string): RateLimit | undefined {
  const match = RATE_LIMIT_FORMAT.exec(value.trim());
  if (!match) return undefined;

  const [, limit, amount, unit] = match;
  const windowMs = Number(amount || 1) * MS_PER_UNIT[unit as keyof typeof MS_PER_UNIT];
  return Number(limit) > 0 && windowMs > 0 ? { limit: Number(limit), windowMs } : undefined;
}

export function parseChats(value: string): ChatTarget[] {
  return splitList(value).map((entry) => {
    const [chatId = '', topicId] = entry.split(':');
    return topicId ? { chatId, topicId: Number(topicId) } : { chatId };
  });
}

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function isValidChat({ chatId, topicId }: ChatTarget): boolean {
  return CHAT_ID_FORMAT.test(chatId) && (topicId === undefined || topicId > 0);
}

function isOriginOrWildcard(value: string): boolean {
  return value === ANY_ORIGIN || URL.canParse(value);
}

function toOrigin(value: string): string {
  return value === ANY_ORIGIN ? value : new URL(value).origin;
}

function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

const EnvVariables = z.object({
  TELEGRAM_BOT_TOKEN: z
    .string({ error: 'is required — create a bot with @BotFather and paste its token' })
    .regex(BOT_TOKEN_FORMAT, { error: 'does not look like a bot token (expected 123456:ABC…)' }),
  TELEGRAM_CHAT_IDS: z
    .string({ error: 'is required — run `npm run chat-id` to find yours' })
    .transform(parseChats)
    .refine((chats) => chats.length > 0 && chats.every(isValidChat), {
      error: 'must be comma-separated chat ids, e.g. 123456789,-1001234567890 or -1001234567890:42 for a topic',
    }),
  ALLOWED_ORIGINS: z
    .string({ error: 'is required — list your site origins, e.g. https://example.com (or * to allow any)' })
    .transform(splitList)
    .refine((origins) => origins.length > 0 && origins.every(isOriginOrWildcard), {
      error: 'must be comma-separated origins like https://example.com,https://www.example.com',
    })
    .transform((origins) => origins.map(toOrigin)),
  TELEGRAM_API_URL: z.url(WEB_URL).default('https://api.telegram.org'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOCALE: z.enum(['uk', 'en']).default('uk'),
  TIMEZONE: z.string().default('Europe/Kyiv').refine(isTimeZone, { error: 'is not a valid IANA time zone' }),
  RATE_LIMIT: z
    .string()
    .default('5/10m')
    .transform((value, context) => {
      const rateLimit = parseRateLimit(value);
      if (rateLimit) return rateLimit;
      context.addIssue({ code: 'custom', message: 'must look like 5/10m (requests per window; s, m or h)' });
      return z.NEVER;
    }),
  MIN_FILL_SECONDS: z.coerce.number().min(0).max(60).default(3),
  MAX_LINKS: z.coerce.number().int().min(0).default(2),
  SUCCESS_REDIRECT: z.url(WEB_URL).optional(),
  WEBHOOK_URL: z.url(WEB_URL).optional(),
  WEBHOOK_SECRET: z
    .string()
    .min(MIN_WEBHOOK_SECRET_LENGTH, { error: `must be at least ${MIN_WEBHOOK_SECRET_LENGTH} characters` })
    .optional(),
  TRUST_PROXY: z.stringbool().default(false),
  DEMO_PAGE: z.stringbool().default(false),
});

const EnvSchema = EnvVariables.refine((env) => env.WEBHOOK_URL || !env.WEBHOOK_SECRET, {
  error: 'is set, but WEBHOOK_URL is missing',
  path: ['WEBHOOK_SECRET'],
});

type Env = z.infer<typeof EnvSchema>;

export function loadConfig(variables: Record<string, string | undefined>): Config {
  const result = EnvSchema.safeParse(withoutEmptyValues(variables));
  if (!result.success) throw new ConfigError(describeProblems(result.error.issues));
  return toConfig(result.data);
}

function withoutEmptyValues(variables: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(variables).filter((entry): entry is [string, string] => entry[1] !== undefined && entry[1].trim() !== ''),
  );
}

function describeProblems(issues: Array<{ path: PropertyKey[]; message: string }>): string {
  const lines = issues.map(({ path, message }) => `  • ${path.join('.')} ${message}`);
  return `Invalid configuration:\n${lines.join('\n')}`;
}

function toConfig(env: Env): Config {
  return {
    telegramToken: env.TELEGRAM_BOT_TOKEN,
    telegramApiUrl: env.TELEGRAM_API_URL.replace(/\/+$/, ''),
    chats: env.TELEGRAM_CHAT_IDS,
    allowedOrigins: env.ALLOWED_ORIGINS,
    port: env.PORT,
    host: env.HOST,
    locale: env.LOCALE,
    timeZone: env.TIMEZONE,
    rateLimit: env.RATE_LIMIT,
    minFillMs: env.MIN_FILL_SECONDS * 1000,
    maxLinks: env.MAX_LINKS,
    successRedirect: env.SUCCESS_REDIRECT,
    webhook: env.WEBHOOK_URL ? { url: env.WEBHOOK_URL, secret: env.WEBHOOK_SECRET } : undefined,
    trustProxy: env.TRUST_PROXY,
    demoPage: env.DEMO_PAGE,
  };
}

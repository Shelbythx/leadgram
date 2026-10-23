import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, parseChats, parseRate } from '../src/config.ts';
import { escapeHtml, formatLead, humanizeKey } from '../src/format.ts';
import { messages } from '../src/i18n.ts';
import { RateLimiter, RecentLeads } from '../src/rate-limit.ts';

describe('RateLimiter', () => {
  it('allows N hits per window and tells when to retry', () => {
    const limiter = new RateLimiter(2, 60_000);
    expect(limiter.hit('ip', 0).allowed).toBe(true);
    expect(limiter.hit('ip', 10_000).allowed).toBe(true);
    expect(limiter.hit('ip', 20_000)).toEqual({ allowed: false, retryAfterSeconds: 40 });
    expect(limiter.hit('other-ip', 20_000).allowed).toBe(true);
    expect(limiter.hit('ip', 60_001).allowed).toBe(true); // the first hit has left the window
  });

  it('sweeps idle keys', () => {
    const limiter = new RateLimiter(5, 1000);
    limiter.hit('a', 0);
    limiter.hit('b', 1500);
    limiter.sweep(2000);
    expect(limiter.size).toBe(1);
  });
});

describe('RecentLeads', () => {
  it('detects duplicates within the TTL only', () => {
    const recent = new RecentLeads(60_000);
    const key = RecentLeads.key(['1.2.3.4', '+380671234567']);
    expect(recent.isDuplicate(key, 0)).toBe(false);
    expect(recent.isDuplicate(key, 30_000)).toBe(true);
    expect(recent.isDuplicate(key, 61_000)).toBe(false);
  });

  it('can forget a key so the visitor may retry', () => {
    const recent = new RecentLeads(60_000);
    recent.isDuplicate('k', 0);
    recent.forget('k');
    expect(recent.isDuplicate('k', 1)).toBe(false);
  });
});

describe('formatLead', () => {
  const context = { t: messages.uk, locale: 'uk' as const, timeZone: 'Europe/Kyiv', receivedAt: new Date('2026-10-09T11:32:00Z') };

  it('builds a readable Telegram message', () => {
    const text = formatLead(
      {
        name: 'Олена',
        phone: '+380671234567',
        message: 'Потрібна кава на 40 гостей',
        extra: [['preferred_time', 'Вечір']],
        form: 'Кава на захід',
        page: 'https://cafe.example/catering?utm_source=instagram&utm_campaign=autumn',
      },
      context,
    );
    expect(text).toContain('🆕 <b>Нова заявка</b> · Кава на захід');
    expect(text).toContain("👤 Ім'я: <b>Олена</b>");
    expect(text).toContain('📞 Телефон: +380671234567');
    expect(text).toContain('<blockquote>Потрібна кава на 40 гостей</blockquote>');
    expect(text).toContain('▫️ Preferred time: Вечір');
    expect(text).toContain('<a href="https://cafe.example/catering?utm_source=instagram&amp;utm_campaign=autumn">cafe.example/catering</a>');
    expect(text).toContain('📊 UTM: source=instagram · campaign=autumn');
    expect(text).toContain('🕒 Отримано: 09.10.26, 14:32');
  });

  it('escapes HTML everywhere and ignores non-http page links', () => {
    const text = formatLead(
      { name: '<b>x</b>', email: 'a@b.co', message: '1 < 2 & "q"', extra: [['<k>', '<v>']], page: 'javascript:alert(1)' },
      context,
    );
    expect(text).not.toContain('<b>x</b>');
    expect(text).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(text).toContain('1 &lt; 2 &amp; &quot;q&quot;');
    expect(text).not.toContain('javascript');
  });

  it('humanizes field names', () => {
    expect(humanizeKey('preferred_time')).toBe('Preferred time');
    expect(humanizeKey('deliveryDate')).toBe('Delivery date');
    expect(humanizeKey('кількість-гостей')).toBe('Кількість гостей');
    expect(escapeHtml('<&>"')).toBe('&lt;&amp;&gt;&quot;');
  });
});

describe('config', () => {
  const env = {
    TELEGRAM_BOT_TOKEN: '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef123',
    TELEGRAM_CHAT_IDS: '123456789, -1001234567890:7',
    ALLOWED_ORIGINS: 'https://cafe.example/, https://www.cafe.example',
  };

  it('parses a minimal environment with defaults', () => {
    const config = loadConfig(env);
    expect(config.chats).toEqual([{ chatId: '123456789' }, { chatId: '-1001234567890', threadId: 7 }]);
    expect(config.allowedOrigins).toEqual(['https://cafe.example', 'https://www.cafe.example']);
    expect(config).toMatchObject({ port: 3000, locale: 'uk', timeZone: 'Europe/Kyiv', rateLimit: { limit: 5, windowMs: 600_000 }, trustProxy: false });
  });

  it('treats empty variables as unset', () => {
    expect(loadConfig({ ...env, PORT: '', SUCCESS_REDIRECT: '' }).port).toBe(3000);
  });

  it('explains every problem at once', () => {
    expect(() => loadConfig({ TELEGRAM_BOT_TOKEN: 'nope', ALLOWED_ORIGINS: 'cafe.example', TIMEZONE: 'Mars/Base', RATE_LIMIT: 'lots' })).toThrowError(ConfigError);
    try {
      loadConfig({ TELEGRAM_BOT_TOKEN: 'nope', ALLOWED_ORIGINS: 'cafe.example', TIMEZONE: 'Mars/Base', RATE_LIMIT: 'lots' });
    } catch (error) {
      const message = (error as Error).message;
      for (const key of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_IDS', 'ALLOWED_ORIGINS', 'TIMEZONE', 'RATE_LIMIT']) expect(message).toContain(key);
    }
  });

  it('parses rates and chat lists', () => {
    expect(parseRate('10/h')).toEqual({ limit: 10, windowMs: 3_600_000 });
    expect(parseRate('3 / 30s')).toEqual({ limit: 3, windowMs: 30_000 });
    expect(parseRate('0/1m')).toBeUndefined();
    expect(parseChats('@my_channel,,42')).toEqual([{ chatId: '@my_channel' }, { chatId: '42' }]);
  });
});

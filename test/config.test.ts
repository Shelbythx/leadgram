import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, parseChats, parseRateLimit } from '../src/config.ts';

const requiredEnv = {
  TELEGRAM_BOT_TOKEN: '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef123',
  TELEGRAM_CHAT_IDS: '123456789, -1001234567890:7',
  ALLOWED_ORIGINS: 'https://cafe.example/, https://www.cafe.example',
};

const invalidEnv = { TELEGRAM_BOT_TOKEN: 'nope', ALLOWED_ORIGINS: 'cafe.example', TIMEZONE: 'Mars/Base', RATE_LIMIT: 'lots' };

describe('loadConfig', () => {
  it('parses a minimal environment with defaults', () => {
    const config = loadConfig(requiredEnv);
    expect(config.chats).toEqual([{ chatId: '123456789' }, { chatId: '-1001234567890', topicId: 7 }]);
    expect(config.allowedOrigins).toEqual(['https://cafe.example', 'https://www.cafe.example']);
    expect(config).toMatchObject({
      port: 3000,
      locale: 'uk',
      timeZone: 'Europe/Kyiv',
      rateLimit: { limit: 5, windowMs: 600_000 },
      telegramApiUrl: 'https://api.telegram.org',
      trustProxy: false,
    });
  });

  it('treats empty variables as unset', () => {
    expect(loadConfig({ ...requiredEnv, PORT: '', SUCCESS_REDIRECT: ' ' }).port).toBe(3000);
  });

  it('explains every problem at once', () => {
    expect(() => loadConfig(invalidEnv)).toThrowError(ConfigError);
    expect(() => loadConfig(invalidEnv)).toThrowError(/TELEGRAM_BOT_TOKEN[\s\S]*TELEGRAM_CHAT_IDS[\s\S]*ALLOWED_ORIGINS[\s\S]*TIMEZONE[\s\S]*RATE_LIMIT/);
  });
});

describe('parseRateLimit', () => {
  it.each([
    ['10/h', { limit: 10, windowMs: 3_600_000 }],
    ['3 / 30s', { limit: 3, windowMs: 30_000 }],
    ['0/1m', undefined],
    ['fast', undefined],
  ])('%s', (value, expected) => {
    expect(parseRateLimit(value)).toEqual(expected);
  });
});

describe('parseChats', () => {
  it('reads usernames, ids and topics, skipping empty entries', () => {
    expect(parseChats('@my_channel,,42, -100:3')).toEqual([{ chatId: '@my_channel' }, { chatId: '42' }, { chatId: '-100', topicId: 3 }]);
  });
});

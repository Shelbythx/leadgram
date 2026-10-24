import type { Config } from '../src/config.ts';
import type { DeliveryResult, Notifier } from '../src/telegram.ts';

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    telegramToken: '123456:TEST_TOKEN_TEST_TOKEN_TEST_TOKEN_00',
    telegramApiUrl: 'https://api.telegram.org',
    chats: [{ chatId: '42' }],
    allowedOrigins: ['https://cafe.example'],
    port: 3000,
    host: '127.0.0.1',
    locale: 'uk',
    timeZone: 'Europe/Kyiv',
    rateLimit: { limit: 3, windowMs: 60_000 },
    minFillMs: 3000,
    maxLinks: 2,
    trustProxy: false,
    demoPage: false,
    ...overrides,
  };
}

export class FakeNotifier implements Notifier {
  sent: string[] = [];
  failWith: Error | undefined;

  async send(html: string): Promise<DeliveryResult> {
    if (this.failWith) throw this.failWith;
    this.sent.push(html);
    return { delivered: 1, failed: [] };
  }
}

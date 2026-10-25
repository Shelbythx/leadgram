import type { Config } from '../src/config.ts';
import type { Destination } from '../src/delivery/destination.ts';
import type { Lead } from '../src/lead/lead.ts';

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

export class FakeDestination implements Destination {
  readonly name: string;
  readonly leads: Lead[] = [];
  failWith: Error | undefined;

  constructor(name = 'fake') {
    this.name = name;
  }

  async deliver(lead: Lead): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.leads.push(lead);
  }
}

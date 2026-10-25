import { describe, expect, it } from 'vitest';
import { createTelegramDestination } from '../src/delivery/telegram-destination.ts';
import { TEXTS } from '../src/i18n.ts';
import { silentLogger } from '../src/log.ts';
import type { DeliveryResult } from '../src/telegram.ts';

const format = { texts: TEXTS.uk, locale: 'uk' as const, timeZone: 'Europe/Kyiv' };

function fakeTelegram(result: DeliveryResult = { delivered: 1, failed: [] }) {
  const sent: string[] = [];
  return { sent, send: async (html: string) => (sent.push(html), result) };
}

describe('telegram destination', () => {
  it('sends the lead as a formatted message', async () => {
    const telegram = fakeTelegram();
    const destination = createTelegramDestination({ telegram, format, log: silentLogger });

    await destination.deliver({ name: 'Олена', phone: '+380671234567', extra: [] }, new Date('2026-10-09T11:32:00Z'));
    expect(telegram.sent[0]).toContain("👤 Ім'я: <b>Олена</b>");
    expect(telegram.sent[0]).toContain('🕒 Отримано: 09.10.26, 14:32');
  });

  it('logs chats that did not receive the message', async () => {
    const warnings: unknown[] = [];
    const log = { ...silentLogger, warn: (event: string, fields?: object) => void warnings.push({ event, ...fields }) };
    const destination = createTelegramDestination({ telegram: fakeTelegram({ delivered: 1, failed: ['chat 2: chat not found'] }), format, log });

    await destination.deliver({ email: 'a@b.co', extra: [] }, new Date());
    expect(warnings).toEqual([{ event: 'telegram.partial_failure', reason: 'chat 2: chat not found' }]);
  });
});

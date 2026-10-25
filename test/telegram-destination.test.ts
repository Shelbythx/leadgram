import { describe, expect, it } from 'vitest';
import { createTelegramDestination } from '../src/delivery/telegram-destination.ts';
import { TEXTS } from '../src/i18n.ts';
import type { Attachment } from '../src/lead/attachments.ts';
import { silentLogger } from '../src/log.ts';
import type { DeliveryResult, UploadFile } from '../src/telegram.ts';

const format = { texts: TEXTS.uk, locale: 'uk' as const, timeZone: 'Europe/Kyiv' };

function fakeTelegram(result: DeliveryResult = { delivered: 1, problems: [] }) {
  const sent: Array<{ html: string; files: readonly UploadFile[] }> = [];
  const send = async (html: string, files: readonly UploadFile[] = []) => {
    sent.push({ html, files });
    return result;
  };
  return { sent, send };
}

describe('telegram destination', () => {
  it('sends the lead as a formatted message', async () => {
    const telegram = fakeTelegram();
    const destination = createTelegramDestination({ telegram, format, log: silentLogger });

    await destination.deliver({ name: 'Олена', phone: '+380671234567', extra: [], attachments: [] }, new Date('2026-10-09T11:32:00Z'));
    expect(telegram.sent[0]?.html).toContain("👤 Ім'я: <b>Олена</b>");
    expect(telegram.sent[0]?.html).toContain('🕒 Отримано: 09.10.26, 14:32');
  });

  it('passes the attachments along', async () => {
    const telegram = fakeTelegram();
    const photo: Attachment = { fieldName: 'photos', fileName: 'hall.jpg', mimeType: 'image/jpeg', content: new Blob(['x']) };

    await createTelegramDestination({ telegram, format, log: silentLogger }).deliver({ phone: '+380671234567', extra: [], attachments: [photo] }, new Date());
    expect(telegram.sent[0]?.files).toEqual([photo]);
  });

  it('logs problems with single chats or files', async () => {
    const warnings: unknown[] = [];
    const log = { ...silentLogger, warn: (event: string, fields?: object) => void warnings.push({ event, ...fields }) };
    const destination = createTelegramDestination({ telegram: fakeTelegram({ delivered: 1, problems: ['chat 2: chat not found'] }), format, log });

    await destination.deliver({ email: 'a@b.co', extra: [], attachments: [] }, new Date());
    expect(warnings).toEqual([{ event: 'telegram.partial_failure', reason: 'chat 2: chat not found' }]);
  });
});

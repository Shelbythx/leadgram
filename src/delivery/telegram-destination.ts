import { type MessageFormat, renderLeadMessage } from '../lead/message.ts';
import type { Logger } from '../log.ts';
import type { Telegram } from '../telegram.ts';
import type { Destination } from './destination.ts';

export interface TelegramDestinationOptions {
  telegram: Pick<Telegram, 'send'>;
  format: MessageFormat;
  log: Logger;
}

export function createTelegramDestination({ telegram, format, log }: TelegramDestinationOptions): Destination {
  return {
    name: 'telegram',
    async deliver(lead, receivedAt) {
      const result = await telegram.send(renderLeadMessage(lead, { ...format, receivedAt }));
      for (const reason of result.failed) log.warn('telegram.partial_failure', { reason });
    },
  };
}

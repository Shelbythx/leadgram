import type { Config } from '../config.ts';
import { TEXTS } from '../i18n.ts';
import type { Logger } from '../log.ts';
import type { Telegram } from '../telegram.ts';
import type { Destination } from './destination.ts';
import { createTelegramDestination } from './telegram-destination.ts';
import { createWebhookDestination } from './webhook-destination.ts';

export function createDestinations(config: Config, telegram: Pick<Telegram, 'send'>, log: Logger): Destination[] {
  const format = { texts: TEXTS[config.locale], locale: config.locale, timeZone: config.timeZone };
  const destinations = [createTelegramDestination({ telegram, format, log })];
  if (config.webhook) destinations.push(createWebhookDestination(config.webhook));
  return destinations;
}

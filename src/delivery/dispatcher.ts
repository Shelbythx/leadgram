import { errorMessage } from '../errors.ts';
import type { Lead } from '../lead/lead.ts';
import type { Logger } from '../log.ts';
import type { Destination } from './destination.ts';

export type Dispatch = (lead: Lead, receivedAt: Date, origin: string | undefined) => Promise<boolean>;

export function createDispatcher(destinations: readonly Destination[], log: Logger): Dispatch {
  async function deliverTo(destination: Destination, lead: Lead, receivedAt: Date, origin: string | undefined): Promise<boolean> {
    try {
      await destination.deliver(lead, receivedAt);
      log.info('lead.delivered', { destination: destination.name, origin, form: lead.formName });
      return true;
    } catch (error) {
      log.error('lead.delivery_failed', { destination: destination.name, origin, reason: errorMessage(error) });
      return false;
    }
  }

  return (lead, receivedAt, origin) => firstSuccess(destinations.map((destination) => deliverTo(destination, lead, receivedAt, origin)));
}

function firstSuccess(deliveries: Array<Promise<boolean>>): Promise<boolean> {
  const successes = deliveries.map(async (delivery) => {
    if (!(await delivery)) throw new Error('not delivered');
    return true;
  });
  return Promise.any(successes).catch(() => false);
}

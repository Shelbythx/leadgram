import type { Lead } from '../lead/lead.ts';

export interface Destination {
  readonly name: string;
  deliver(lead: Lead, receivedAt: Date): Promise<void>;
}

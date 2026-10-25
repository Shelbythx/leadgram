import { describe, expect, it } from 'vitest';
import type { Destination } from '../src/delivery/destination.ts';
import { createDispatcher } from '../src/delivery/dispatcher.ts';
import type { LogFields } from '../src/log.ts';
import { FakeDestination } from './helpers.ts';

const lead = { phone: '+380671234567', extra: [], formName: 'Callback', attachments: [] };
const receivedAt = new Date('2026-10-24T12:00:00Z');

function recordingLogger() {
  const entries: Array<{ level: string; event: string; fields?: LogFields }> = [];
  const record = (level: string) => (event: string, fields?: LogFields) => void entries.push({ level, event, fields });
  return { entries, log: { info: record('info'), warn: record('warn'), error: record('error') } };
}

function failing(name: string, reason: string): FakeDestination {
  const destination = new FakeDestination(name);
  destination.failWith = new Error(reason);
  return destination;
}

const neverFinishes: Destination = { name: 'slow', deliver: () => new Promise(() => {}) };

describe('dispatcher', () => {
  it('delivers the lead to every destination', async () => {
    const telegram = new FakeDestination('telegram');
    const webhook = new FakeDestination('webhook');
    const dispatch = createDispatcher([telegram, webhook], recordingLogger().log);

    expect(await dispatch(lead, receivedAt, 'https://cafe.example')).toBe(true);
    expect(telegram.leads).toEqual([lead]);
    expect(webhook.leads).toEqual([lead]);
  });

  it('succeeds when at least one destination accepted the lead', async () => {
    const { entries, log } = recordingLogger();
    const dispatch = createDispatcher([failing('webhook', 'HTTP 500'), new FakeDestination('telegram')], log);

    expect(await dispatch(lead, receivedAt, undefined)).toBe(true);
    expect(entries).toContainEqual({ level: 'error', event: 'lead.delivery_failed', fields: { destination: 'webhook', origin: undefined, reason: 'HTTP 500' } });
    expect(entries).toContainEqual({ level: 'info', event: 'lead.delivered', fields: { destination: 'telegram', origin: undefined, form: 'Callback' } });
  });

  it('fails when every destination failed', async () => {
    const dispatch = createDispatcher([failing('telegram', 'down'), failing('webhook', 'down')], recordingLogger().log);
    expect(await dispatch(lead, receivedAt, undefined)).toBe(false);
  });

  it('answers as soon as one destination succeeds, without waiting for slow ones', async () => {
    const dispatch = createDispatcher([neverFinishes, new FakeDestination('telegram')], recordingLogger().log);
    expect(await dispatch(lead, receivedAt, undefined)).toBe(true);
  });
});

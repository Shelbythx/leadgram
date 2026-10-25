import { describe, expect, it } from 'vitest';
import { createDestinations } from '../src/delivery/destinations.ts';
import { silentLogger } from '../src/log.ts';
import { testConfig } from './helpers.ts';

const telegram = { send: async () => ({ delivered: 1, failed: [] }) };
const names = (config = testConfig()) => createDestinations(config, telegram, silentLogger).map(({ name }) => name);

describe('createDestinations', () => {
  it('always delivers to Telegram', () => {
    expect(names()).toEqual(['telegram']);
  });

  it('adds the webhook when it is configured', () => {
    expect(names(testConfig({ webhook: { url: 'https://hooks.example.com/leads' } }))).toEqual(['telegram', 'webhook']);
  });
});

import { describe, expect, it } from 'vitest';
import { type Attempt, DeliveryError, type Failure, isRetryableStatus, retry, serverRequestedWaitMs } from '../src/delivery/retry.ts';

function scriptedAttempts<T = void>(...results: Array<Attempt<T>>) {
  let calls = 0;
  const attempt = async () => results[Math.min(calls++, results.length - 1)] as Attempt<T>;
  return { attempt, calls: () => calls };
}

function recordingPolicy(maxAttempts = 3) {
  const waits: number[] = [];
  return { waits, policy: { maxAttempts, backoffMs: 100, sleep: async (ms: number) => void waits.push(ms) } };
}

const temporaryFailure: Failure = { ok: false, retryable: true, reason: 'HTTP 503' };

describe('retry', () => {
  it('returns the value of the successful attempt', async () => {
    const { attempt } = scriptedAttempts<number>(temporaryFailure, { ok: true, value: 42 });
    expect(await retry(attempt, recordingPolicy().policy)).toBe(42);
  });

  it('stops at the first success', async () => {
    const { attempt, calls } = scriptedAttempts(temporaryFailure, { ok: true, value: undefined });
    const { waits, policy } = recordingPolicy();

    await retry(attempt, policy);
    expect(calls()).toBe(2);
    expect(waits).toEqual([100]);
  });

  it('backs off linearly and gives up after the last attempt', async () => {
    const { attempt, calls } = scriptedAttempts(temporaryFailure);
    const { waits, policy } = recordingPolicy(3);

    await expect(retry(attempt, policy)).rejects.toThrow(new DeliveryError('HTTP 503'));
    expect(calls()).toBe(3);
    expect(waits).toEqual([100, 200]);
  });

  it('waits as long as the server asks', async () => {
    const { attempt } = scriptedAttempts({ ...temporaryFailure, retryAfterMs: 2000 }, { ok: true, value: undefined });
    const { waits, policy } = recordingPolicy();

    await retry(attempt, policy);
    expect(waits).toEqual([2000]);
  });

  it('does not retry permanent failures', async () => {
    const { attempt, calls } = scriptedAttempts({ ok: false, retryable: false, reason: 'HTTP 400' });
    await expect(retry(attempt, recordingPolicy().policy)).rejects.toThrow('HTTP 400');
    expect(calls()).toBe(1);
  });
});

describe('isRetryableStatus', () => {
  it.each([
    [429, true],
    [500, true],
    [503, true],
    [400, false],
    [404, false],
  ])('%i → %s', (status, expected) => {
    expect(isRetryableStatus(status)).toBe(expected);
  });
});

describe('serverRequestedWaitMs', () => {
  it.each([
    [3, 3000],
    [60, 10_000],
    [0, undefined],
    [Number.NaN, undefined],
    [undefined, undefined],
  ])('%s s → %s ms', (seconds, expected) => {
    expect(serverRequestedWaitMs(seconds)).toBe(expected);
  });
});

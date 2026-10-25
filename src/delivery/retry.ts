export type Failure = { ok: false; retryable: boolean; reason: string; retryAfterMs?: number | undefined };

export type Attempt<T = void> = { ok: true; value: T } | Failure;

export interface RetryPolicy {
  maxAttempts: number;
  backoffMs: number;
  sleep: (ms: number) => Promise<void>;
}

export class DeliveryError extends Error {
  override name = 'DeliveryError';
}

const MAX_SERVER_REQUESTED_WAIT_SECONDS = 10;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_ERROR = 500;
const MS_PER_SECOND = 1000;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const DEFAULT_RETRY_POLICY: RetryPolicy = { maxAttempts: 3, backoffMs: 500, sleep: delay };

export async function retry<T>(attempt: () => Promise<Attempt<T>>, policy: RetryPolicy): Promise<T> {
  for (let attemptNumber = 1; ; attemptNumber++) {
    const result = await attempt();
    if (result.ok) return result.value;
    if (!result.retryable || attemptNumber >= policy.maxAttempts) throw new DeliveryError(result.reason);
    await policy.sleep(result.retryAfterMs ?? policy.backoffMs * attemptNumber);
  }
}

export function isRetryableStatus(status: number): boolean {
  return status === HTTP_TOO_MANY_REQUESTS || status >= HTTP_SERVER_ERROR;
}

export function serverRequestedWaitMs(seconds: number | undefined): number | undefined {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return undefined;
  return Math.min(seconds, MAX_SERVER_REQUESTED_WAIT_SECONDS) * MS_PER_SECOND;
}

import { createHmac, randomUUID } from 'node:crypto';
import { errorMessage } from '../errors.ts';
import type { Lead } from '../lead/lead.ts';
import { parseWebUrl, type UtmParameters, utmParameters } from '../lead/source.ts';
import type { Destination } from './destination.ts';
import { type Attempt, DEFAULT_RETRY_POLICY, isRetryableStatus, retry, type RetryPolicy, serverRequestedWaitMs } from './retry.ts';

export interface WebhookPayload {
  id: string;
  event: typeof LEAD_CREATED;
  receivedAt: string;
  lead: {
    name: string | null;
    phone: string | null;
    email: string | null;
    message: string | null;
    formName: string | null;
    page: string | null;
    utm: UtmParameters;
    fields: Record<string, string>;
    attachments: Array<{ name: string; mimeType: string; size: number }>;
  };
}

export interface WebhookOptions {
  url: string;
  secret?: string | undefined;
  fetch?: typeof fetch;
  retryPolicy?: Partial<RetryPolicy>;
  newId?: () => string;
}

export const SIGNATURE_HEADER = 'X-Leadgram-Signature';

const LEAD_CREATED = 'lead.created';
const USER_AGENT = 'leadgram-webhook';
const REQUEST_TIMEOUT_MS = 10_000;

export function createWebhookDestination(options: WebhookOptions): Destination {
  const { url, secret, fetch: fetchImpl = globalThis.fetch, newId = randomUUID } = options;
  const retryPolicy = { ...DEFAULT_RETRY_POLICY, ...options.retryPolicy };

  async function attemptPost(body: string, headers: Record<string, string>): Promise<Attempt> {
    try {
      const response = await fetchImpl(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      await response.body?.cancel();
      if (response.ok) return { ok: true, value: undefined };
      return {
        ok: false,
        retryable: isRetryableStatus(response.status),
        reason: `HTTP ${response.status}`,
        retryAfterMs: serverRequestedWaitMs(retryAfterSeconds(response)),
      };
    } catch (error) {
      return { ok: false, retryable: true, reason: errorMessage(error) };
    }
  }

  return {
    name: 'webhook',
    async deliver(lead, receivedAt) {
      const body = JSON.stringify(toWebhookPayload(newId(), lead, receivedAt));
      const headers = {
        'content-type': 'application/json',
        'user-agent': USER_AGENT,
        ...(secret ? { [SIGNATURE_HEADER]: signPayload(body, secret) } : {}),
      };
      await retry(() => attemptPost(body, headers), retryPolicy);
    },
  };
}

export function toWebhookPayload(id: string, lead: Lead, receivedAt: Date): WebhookPayload {
  return {
    id,
    event: LEAD_CREATED,
    receivedAt: receivedAt.toISOString(),
    lead: {
      name: lead.name ?? null,
      phone: lead.phone ?? null,
      email: lead.email ?? null,
      message: lead.message ?? null,
      formName: lead.formName ?? null,
      page: lead.page ?? null,
      utm: utmParameters(parseWebUrl(lead.page)),
      fields: Object.fromEntries(lead.extra),
      attachments: lead.attachments.map(({ fileName, mimeType, content }) => ({ name: fileName, mimeType, size: content.size })),
    },
  };
}

function retryAfterSeconds(response: Response): number | undefined {
  const header = response.headers.get('retry-after');
  return header === null ? undefined : Number(header);
}

export function signPayload(body: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

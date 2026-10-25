import { createHmac } from 'node:crypto';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createWebhookDestination, signPayload, toWebhookPayload, type WebhookOptions } from '../src/delivery/webhook-destination.ts';
import type { Lead } from '../src/lead/lead.ts';

interface ScriptedResponse {
  status: number;
  headers?: Record<string, string>;
}

interface ReceivedRequest {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  body: string;
}

const lead: Lead = {
  name: 'Олена',
  phone: '+380671234567',
  message: 'Кава на 40 гостей',
  extra: [
    ['guests', '20–50'],
    ['extras', 'Кава-бар, Випічка'],
  ],
  formName: 'Кава на захід',
  page: 'https://cafe.example/catering?utm_source=instagram&utm_campaign=autumn',
  attachments: [],
};
const receivedAt = new Date('2026-10-24T17:48:00.000Z');
const noWait = { sleep: async () => {} };

function sequentialIds() {
  let count = 0;
  return () => `id-${++count}`;
}

let server: Server;
let baseUrl: string;
let received: ReceivedRequest[];
let scripted: ScriptedResponse[];

beforeAll(async () => {
  server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    received.push({ method: req.method ?? '', path: req.url ?? '', headers: req.headers, body });

    if (req.url === '/apps-script') {
      res.writeHead(302, { location: '/apps-script/result' });
      return res.end();
    }
    const { status, headers } = scripted.shift() ?? { status: 200 };
    res.writeHead(status, headers);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
  received = [];
  scripted = [];
});

const webhook = (options: Partial<WebhookOptions> = {}) =>
  createWebhookDestination({ url: `${baseUrl}/hook`, retryPolicy: noWait, newId: () => 'lead-1', ...options });

describe('webhook destination', () => {
  it('posts the lead as JSON', async () => {
    await webhook().deliver(lead, receivedAt);

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ method: 'POST', path: '/hook' });
    expect(received[0]?.headers['content-type']).toBe('application/json');
    expect(JSON.parse(received[0]?.body ?? '')).toEqual(toWebhookPayload('lead-1', lead, receivedAt));
  });

  it('signs the body when a secret is set', async () => {
    const secret = 'a-long-shared-secret';
    await webhook({ secret }).deliver(lead, receivedAt);

    const request = received[0];
    const expected = `sha256=${createHmac('sha256', secret).update(request?.body ?? '').digest('hex')}`;
    expect(request?.headers['x-leadgram-signature']).toBe(expected);
  });

  it('does not send a signature without a secret', async () => {
    await webhook().deliver(lead, receivedAt);
    expect(received[0]?.headers).not.toHaveProperty('x-leadgram-signature');
  });

  it('retries server errors with the same lead id', async () => {
    scripted = [{ status: 503 }, { status: 502 }];
    await webhook({ newId: sequentialIds() }).deliver(lead, receivedAt);

    expect(received).toHaveLength(3);
    expect(new Set(received.map((request) => JSON.parse(request.body).id))).toEqual(new Set(['id-1']));
  });

  it('honours Retry-After', async () => {
    const waits: number[] = [];
    scripted = [{ status: 429, headers: { 'retry-after': '2' } }];
    await webhook({ retryPolicy: { sleep: async (ms) => void waits.push(ms) } }).deliver(lead, receivedAt);

    expect(waits).toEqual([2000]);
  });

  it('fails without retrying when the receiver rejects the lead', async () => {
    scripted = [{ status: 400 }];
    await expect(webhook().deliver(lead, receivedAt)).rejects.toThrow('HTTP 400');
    expect(received).toHaveLength(1);
  });

  it('follows the redirect that Google Apps Script answers with', async () => {
    await webhook({ url: `${baseUrl}/apps-script` }).deliver(lead, receivedAt);
    expect(received.map(({ method, path }) => `${method} ${path}`)).toEqual(['POST /apps-script', 'GET /apps-script/result']);
  });
});

describe('toWebhookPayload', () => {
  it('describes the lead with a stable shape', () => {
    expect(toWebhookPayload('lead-1', lead, receivedAt)).toEqual({
      id: 'lead-1',
      event: 'lead.created',
      receivedAt: '2026-10-24T17:48:00.000Z',
      lead: {
        name: 'Олена',
        phone: '+380671234567',
        email: null,
        message: 'Кава на 40 гостей',
        formName: 'Кава на захід',
        page: 'https://cafe.example/catering?utm_source=instagram&utm_campaign=autumn',
        utm: { source: 'instagram', campaign: 'autumn' },
        fields: { guests: '20–50', extras: 'Кава-бар, Випічка' },
        attachments: [],
      },
    });
  });

  it('describes attachments without their content', () => {
    const photo = { fieldName: 'photos', fileName: 'hall.jpg', mimeType: 'image/jpeg', content: new Blob([new Uint8Array(2048)]) };
    expect(toWebhookPayload('lead-1', { ...lead, attachments: [photo] }, receivedAt).lead.attachments).toEqual([
      { name: 'hall.jpg', mimeType: 'image/jpeg', size: 2048 },
    ]);
  });
});

describe('signPayload', () => {
  it('produces a hex sha256 signature that depends on the secret', () => {
    expect(signPayload('{}', 'first-secret')).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(signPayload('{}', 'first-secret')).not.toBe(signPayload('{}', 'second-secret'));
  });
});

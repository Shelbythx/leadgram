import { beforeEach, describe, expect, it } from 'vitest';
import { createTelegram, TelegramError, type UploadFile } from '../src/telegram.ts';

type ScriptedReply = { status: number; body: object } | Error;

const OK_REPLY = { status: 200, body: { ok: true, result: {} } };
const token = '123:ABC';

function scriptedTelegramApi(repliesByChat: Record<string, ScriptedReply[]> = {}) {
  const calls: Array<{ url: string; payload: Record<string, unknown> }> = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ url: String(input), payload });
    const reply = repliesByChat[String(payload.chat_id)]?.shift() ?? OK_REPLY;
    if (reply instanceof Error) throw reply;
    return Response.json(reply.body, { status: reply.status });
  };
  return { calls, fetch };
}

let sleeps: number[] = [];
const sleep = async (ms: number) => void sleeps.push(ms);

beforeEach(() => {
  sleeps = [];
});

describe('telegram send', () => {
  it('sends HTML to every chat, with topic ids', async () => {
    const api = scriptedTelegramApi();
    const telegram = createTelegram({ token, chats: [{ chatId: '1' }, { chatId: '-100', topicId: 7 }], fetch: api.fetch, retryPolicy: { sleep } });

    expect(await telegram.send('<b>hi</b>')).toEqual({ delivered: 2, problems: [] });
    expect(api.calls[0]?.url).toBe('https://api.telegram.org/bot123:ABC/sendMessage');
    expect(api.calls[0]?.payload).not.toHaveProperty('message_thread_id');
    expect(api.calls[1]?.payload).toMatchObject({ chat_id: '-100', message_thread_id: 7, text: '<b>hi</b>', parse_mode: 'HTML' });
  });

  it('waits as long as Telegram asks on flood control, then retries', async () => {
    const api = scriptedTelegramApi({ '1': [{ status: 429, body: { ok: false, parameters: { retry_after: 3 } } }] });
    await createTelegram({ token, chats: [{ chatId: '1' }], fetch: api.fetch, retryPolicy: { sleep } }).send('x');

    expect(api.calls).toHaveLength(2);
    expect(sleeps).toEqual([3000]);
  });

  it('retries network errors and 5xx with growing backoff', async () => {
    const api = scriptedTelegramApi({ '1': [new Error('ECONNRESET'), { status: 502, body: { ok: false } }] });
    await createTelegram({ token, chats: [{ chatId: '1' }], fetch: api.fetch, retryPolicy: { sleep } }).send('x');

    expect(api.calls).toHaveLength(3);
    expect(sleeps).toEqual([500, 1000]);
  });

  it('does not retry client errors', async () => {
    const api = scriptedTelegramApi({ '1': [{ status: 403, body: { ok: false, description: 'Forbidden: bot was blocked by the user' } }] });
    const telegram = createTelegram({ token, chats: [{ chatId: '1' }], fetch: api.fetch, retryPolicy: { sleep } });

    await expect(telegram.send('x')).rejects.toThrow(/bot was blocked/);
    expect(api.calls).toHaveLength(1);
  });

  it('gives up after the last attempt', async () => {
    const api = scriptedTelegramApi({ '1': [new Error('down'), new Error('down'), new Error('down')] });
    const telegram = createTelegram({ token, chats: [{ chatId: '1' }], fetch: api.fetch, retryPolicy: { sleep } });
    await expect(telegram.send('x')).rejects.toBeInstanceOf(TelegramError);
  });

  it('succeeds when at least one chat got the message', async () => {
    const api = scriptedTelegramApi({ '2': [{ status: 400, body: { ok: false, description: 'Bad Request: chat not found' } }] });
    const telegram = createTelegram({ token, chats: [{ chatId: '1' }, { chatId: '2' }], fetch: api.fetch, retryPolicy: { sleep } });
    expect(await telegram.send('x')).toEqual({ delivered: 1, problems: ['chat 2: Bad Request: chat not found'] });
  });

  it('fails when no chat got the message', async () => {
    const api = scriptedTelegramApi({ '1': [{ status: 400, body: { ok: false, description: 'chat not found' } }] });
    const telegram = createTelegram({ token, chats: [{ chatId: '1' }], fetch: api.fetch, retryPolicy: { sleep } });
    await expect(telegram.send('x')).rejects.toBeInstanceOf(TelegramError);
  });
});

describe('telegram bot info', () => {
  const replyWith = (body: object): typeof globalThis.fetch => async () => Response.json(body);

  it('returns the bot username', async () => {
    const telegram = createTelegram({ token, chats: [], fetch: replyWith({ ok: true, result: { username: 'cafe_bot' } }) });
    expect(await telegram.botUsername()).toBe('cafe_bot');
  });

  it('rejects an invalid token', async () => {
    const telegram = createTelegram({ token, chats: [], fetch: replyWith({ ok: false, description: 'Unauthorized' }) });
    await expect(telegram.botUsername()).rejects.toThrow('Unauthorized');
  });

  it('lists each chat that wrote to the bot once', async () => {
    const chat = (id: number, type: string) => ({ id, type, title: `chat ${id}` });
    const updates = [{ message: { chat: chat(1, 'private') } }, { my_chat_member: { chat: chat(-100, 'supergroup') } }, { message: { chat: chat(1, 'private') } }];
    const telegram = createTelegram({ token, chats: [], fetch: replyWith({ ok: true, result: updates }) });

    expect((await telegram.recentChats()).map((c) => c.id)).toEqual([1, -100]);
  });
});

describe('telegram files', () => {
  interface RecordedCall {
    method: string;
    json?: Record<string, unknown>;
    form?: FormData;
  }

  function recordingTelegramApi({ rejectUploads = false } = {}) {
    const calls: RecordedCall[] = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const method = String(input).split('/').pop() ?? '';
      if (init?.body instanceof FormData) {
        calls.push({ method, form: init.body });
        return rejectUploads ? Response.json({ ok: false, description: 'Bad Request: wrong file' }, { status: 400 }) : Response.json({ ok: true, result: [] });
      }
      calls.push({ method, json: JSON.parse(String(init?.body)) });
      return Response.json({ ok: true, result: { message_id: 55 } });
    };
    return { calls, fetch };
  }

  const file = (fileName: string, mimeType: string, size = 10): UploadFile => ({ fileName, mimeType, content: new Blob([new Uint8Array(size)]) });
  const uploadedNames = (form: FormData | undefined) =>
    [...(form?.entries() ?? [])].flatMap(([name, value]) => (value instanceof File ? [`${name}=${value.name}`] : []));

  it('sends files as a reply to the lead message, inside the same topic', async () => {
    const api = recordingTelegramApi();
    const telegram = createTelegram({ token, chats: [{ chatId: '-100', topicId: 7 }], fetch: api.fetch, retryPolicy: { sleep } });

    await telegram.send('lead', [file('hall.jpg', 'image/jpeg'), file('stage.png', 'image/png'), file('menu.pdf', 'application/pdf')]);

    expect(api.calls.map(({ method }) => method)).toEqual(['sendMessage', 'sendMediaGroup', 'sendDocument']);
    const album = api.calls[1]?.form;
    expect(album?.get('chat_id')).toBe('-100');
    expect(album?.get('message_thread_id')).toBe('7');
    expect(JSON.parse(String(album?.get('reply_parameters')))).toEqual({ message_id: 55, allow_sending_without_reply: true });
    expect(JSON.parse(String(album?.get('media')))).toEqual([
      { type: 'photo', media: 'attach://file0' },
      { type: 'photo', media: 'attach://file1' },
    ]);
    expect(uploadedNames(album)).toEqual(['file0=hall.jpg', 'file1=stage.png']);
    expect(uploadedNames(api.calls[2]?.form)).toEqual(['document=menu.pdf']);
  });

  it('sends HEIC and photos over 10 MB as documents', async () => {
    const api = recordingTelegramApi();
    const telegram = createTelegram({ token, chats: [{ chatId: '1' }], fetch: api.fetch, retryPolicy: { sleep } });

    await telegram.send('lead', [file('IMG_1.heic', 'image/heic'), file('huge.jpg', 'image/jpeg', 10 * 1024 * 1024 + 1)]);

    expect(api.calls.map(({ method }) => method)).toEqual(['sendMessage', 'sendMediaGroup']);
    expect(JSON.parse(String(api.calls[1]?.form?.get('media')))).toEqual([
      { type: 'document', media: 'attach://file0' },
      { type: 'document', media: 'attach://file1' },
    ]);
  });

  it('splits more than ten photos into several messages', async () => {
    const api = recordingTelegramApi();
    const photos = Array.from({ length: 11 }, (_, index) => file(`${index}.jpg`, 'image/jpeg'));
    await createTelegram({ token, chats: [{ chatId: '1' }], fetch: api.fetch, retryPolicy: { sleep } }).send('lead', photos);

    expect(api.calls.map(({ method }) => method)).toEqual(['sendMessage', 'sendMediaGroup', 'sendPhoto']);
    expect(uploadedNames(api.calls[2]?.form)).toEqual(['photo=10.jpg']);
  });

  it('keeps the lead delivered when files fail and reports the problem', async () => {
    const api = recordingTelegramApi({ rejectUploads: true });
    const telegram = createTelegram({ token, chats: [{ chatId: '1' }], fetch: api.fetch, retryPolicy: { sleep } });

    expect(await telegram.send('lead', [file('a.jpg', 'image/jpeg')])).toEqual({ delivered: 1, problems: ['chat 1: files: Bad Request: wrong file'] });
  });
});

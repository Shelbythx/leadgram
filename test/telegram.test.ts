import { beforeEach, describe, expect, it } from 'vitest';
import { createTelegram, TelegramError } from '../src/telegram.ts';

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

describe('telegram notifier', () => {
  it('sends HTML to every chat, with topic ids', async () => {
    const api = scriptedTelegramApi();
    const telegram = createTelegram({ token, chats: [{ chatId: '1' }, { chatId: '-100', topicId: 7 }], fetch: api.fetch, sleep });

    expect(await telegram.send('<b>hi</b>')).toEqual({ delivered: 2, failed: [] });
    expect(api.calls[0]?.url).toBe('https://api.telegram.org/bot123:ABC/sendMessage');
    expect(api.calls[0]?.payload).not.toHaveProperty('message_thread_id');
    expect(api.calls[1]?.payload).toMatchObject({ chat_id: '-100', message_thread_id: 7, text: '<b>hi</b>', parse_mode: 'HTML' });
  });

  it('waits as long as Telegram asks on flood control, then retries', async () => {
    const api = scriptedTelegramApi({ '1': [{ status: 429, body: { ok: false, parameters: { retry_after: 3 } } }] });
    await createTelegram({ token, chats: [{ chatId: '1' }], fetch: api.fetch, sleep }).send('x');

    expect(api.calls).toHaveLength(2);
    expect(sleeps).toEqual([3000]);
  });

  it('retries network errors and 5xx with growing backoff', async () => {
    const api = scriptedTelegramApi({ '1': [new Error('ECONNRESET'), { status: 502, body: { ok: false } }] });
    await createTelegram({ token, chats: [{ chatId: '1' }], fetch: api.fetch, sleep }).send('x');

    expect(api.calls).toHaveLength(3);
    expect(sleeps).toEqual([500, 1000]);
  });

  it('does not retry client errors', async () => {
    const api = scriptedTelegramApi({ '1': [{ status: 403, body: { ok: false, description: 'Forbidden: bot was blocked by the user' } }] });
    const telegram = createTelegram({ token, chats: [{ chatId: '1' }], fetch: api.fetch, sleep });

    await expect(telegram.send('x')).rejects.toThrow(/bot was blocked/);
    expect(api.calls).toHaveLength(1);
  });

  it('gives up after the last attempt', async () => {
    const api = scriptedTelegramApi({ '1': [new Error('down'), new Error('down'), new Error('down')] });
    const telegram = createTelegram({ token, chats: [{ chatId: '1' }], fetch: api.fetch, sleep });
    await expect(telegram.send('x')).rejects.toBeInstanceOf(TelegramError);
  });

  it('succeeds when at least one chat got the message', async () => {
    const api = scriptedTelegramApi({ '2': [{ status: 400, body: { ok: false, description: 'Bad Request: chat not found' } }] });
    const telegram = createTelegram({ token, chats: [{ chatId: '1' }, { chatId: '2' }], fetch: api.fetch, sleep });
    expect(await telegram.send('x')).toEqual({ delivered: 1, failed: ['chat 2: Bad Request: chat not found'] });
  });

  it('fails when no chat got the message', async () => {
    const api = scriptedTelegramApi({ '1': [{ status: 400, body: { ok: false, description: 'chat not found' } }] });
    const telegram = createTelegram({ token, chats: [{ chatId: '1' }], fetch: api.fetch, sleep });
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

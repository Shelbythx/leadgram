import { describe, expect, it } from 'vitest';
import { createTelegram, TelegramError } from '../src/telegram.ts';

type Reply = { status: number; body: object } | Error;

/** Fake Telegram API: answers each call with the next scripted reply for that chat. */
function fakeApi(script: Record<string, Reply[]>) {
  const calls: Array<{ url: string; payload: Record<string, unknown> }> = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ url: String(input), payload });
    const reply = script[String(payload.chat_id ?? 'any')]?.shift() ?? { status: 200, body: { ok: true, result: {} } };
    if (reply instanceof Error) throw reply;
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json' } });
  };
  return { calls, fetch };
}

const sleeps: number[] = [];
const sleep = async (ms: number) => void sleeps.push(ms);
const token = '123:ABC';

describe('telegram notifier', () => {
  it('sends HTML to every chat, with topic ids', async () => {
    const api = fakeApi({});
    const telegram = createTelegram({ token, chats: [{ chatId: '1' }, { chatId: '-100', threadId: 7 }], fetch: api.fetch, sleep });

    expect(await telegram.send('<b>hi</b>')).toEqual({ delivered: 2, failed: [] });
    expect(api.calls[0]?.url).toBe('https://api.telegram.org/bot123:ABC/sendMessage');
    expect(api.calls[1]?.payload).toMatchObject({ chat_id: '-100', message_thread_id: 7, text: '<b>hi</b>', parse_mode: 'HTML' });
    expect(api.calls[0]?.payload).not.toHaveProperty('message_thread_id');
  });

  it('waits as long as Telegram asks on flood control, then retries', async () => {
    sleeps.length = 0;
    const api = fakeApi({ '1': [{ status: 429, body: { ok: false, description: 'Too Many Requests', parameters: { retry_after: 3 } } }] });
    const telegram = createTelegram({ token, chats: [{ chatId: '1' }], fetch: api.fetch, sleep });

    await telegram.send('x');
    expect(api.calls).toHaveLength(2);
    expect(sleeps).toEqual([3000]);
  });

  it('retries network errors and 5xx, but not 4xx', async () => {
    const flaky = fakeApi({ '1': [new Error('ECONNRESET'), { status: 502, body: { ok: false } }] });
    await createTelegram({ token, chats: [{ chatId: '1' }], fetch: flaky.fetch, sleep }).send('x');
    expect(flaky.calls).toHaveLength(3);

    const forbidden = fakeApi({ '1': [{ status: 403, body: { ok: false, description: 'Forbidden: bot was blocked by the user' } }] });
    await expect(createTelegram({ token, chats: [{ chatId: '1' }], fetch: forbidden.fetch, sleep }).send('x')).rejects.toThrow(
      /bot was blocked/,
    );
    expect(forbidden.calls).toHaveLength(1);
  });

  it('succeeds when at least one chat got the message', async () => {
    const api = fakeApi({ '2': [{ status: 400, body: { ok: false, description: 'Bad Request: chat not found' } }] });
    const telegram = createTelegram({ token, chats: [{ chatId: '1' }, { chatId: '2' }], fetch: api.fetch, sleep });
    expect(await telegram.send('x')).toEqual({ delivered: 1, failed: ['chat 2: Bad Request: chat not found'] });
  });

  it('fails when no chat got the message', async () => {
    const api = fakeApi({ '1': [{ status: 400, body: { ok: false, description: 'chat not found' } }] });
    await expect(createTelegram({ token, chats: [{ chatId: '1' }], fetch: api.fetch, sleep }).send('x')).rejects.toBeInstanceOf(TelegramError);
  });

  it('lists chats that wrote to the bot', async () => {
    const chat = (id: number, type: string) => ({ id, type, title: `chat ${id}` });
    const fetch: typeof globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          ok: true,
          result: [{ message: { chat: chat(1, 'private') } }, { my_chat_member: { chat: chat(-100, 'supergroup') } }, { message: { chat: chat(1, 'private') } }],
        }),
      );
    const chats = await createTelegram({ token, chats: [], fetch }).recentChats();
    expect(chats.map((c) => c.id)).toEqual([1, -100]);
  });
});

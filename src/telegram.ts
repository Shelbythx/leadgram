import { type Attempt, DEFAULT_RETRY_POLICY, isRetryableStatus, retry, type RetryPolicy, serverRequestedWaitMs } from './delivery/retry.ts';
import { errorMessage } from './errors.ts';

export interface ChatTarget {
  chatId: string;
  topicId?: number | undefined;
}

export interface DeliveryResult {
  delivered: number;
  failed: string[];
}

export interface TelegramChat {
  id: number;
  type: string;
  title?: string;
  username?: string;
  first_name?: string;
}

export interface TelegramOptions {
  token: string;
  chats: ChatTarget[];
  apiUrl?: string | undefined;
  fetch?: typeof fetch;
  retryPolicy?: Partial<RetryPolicy>;
}

export type Telegram = ReturnType<typeof createTelegram>;

export class TelegramError extends Error {
  override name = 'TelegramError';
}

interface ApiReply<T> {
  ok: boolean;
  result?: T;
  description?: string;
  parameters?: { retry_after?: number };
}

interface ApiResponse<T> {
  status: number;
  reply: ApiReply<T>;
}

interface Update {
  message?: { chat: TelegramChat };
  channel_post?: { chat: TelegramChat };
  my_chat_member?: { chat: TelegramChat };
}

const DEFAULT_API_URL = 'https://api.telegram.org';
const REQUEST_TIMEOUT_MS = 10_000;
const UPDATES_LIMIT = 100;

export function createTelegram(options: TelegramOptions) {
  const { token, chats, apiUrl = DEFAULT_API_URL, fetch: fetchImpl = globalThis.fetch } = options;
  const retryPolicy = { ...DEFAULT_RETRY_POLICY, ...options.retryPolicy };

  async function call<T>(method: string, payload: object = {}): Promise<ApiResponse<T>> {
    const response = await fetchImpl(`${apiUrl}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const reply = await response.json().catch(() => ({ ok: false, description: `HTTP ${response.status}` }));
    return { status: response.status, reply: reply as ApiReply<T> };
  }

  async function callForResult<T>(method: string, payload?: object): Promise<T> {
    const { reply } = await call<T>(method, payload);
    if (!reply.ok || reply.result === undefined) throw new TelegramError(reply.description ?? `${method} failed`);
    return reply.result;
  }

  async function attemptSend(payload: object): Promise<Attempt> {
    try {
      const { status, reply } = await call('sendMessage', payload);
      if (reply.ok) return { ok: true };
      return {
        ok: false,
        retryable: isRetryableStatus(status),
        reason: reply.description ?? `HTTP ${status}`,
        retryAfterMs: serverRequestedWaitMs(reply.parameters?.retry_after),
      };
    } catch (error) {
      return { ok: false, retryable: true, reason: errorMessage(error) };
    }
  }

  async function sendToChat(chat: ChatTarget, html: string): Promise<void> {
    const payload = messagePayload(chat, html);
    try {
      await retry(() => attemptSend(payload), retryPolicy);
    } catch (error) {
      throw new TelegramError(`chat ${chat.chatId}: ${errorMessage(error)}`);
    }
  }

  return {
    async send(html: string): Promise<DeliveryResult> {
      const results = await Promise.allSettled(chats.map((chat) => sendToChat(chat, html)));
      const failed = results.filter((result) => result.status === 'rejected').map((result) => errorMessage(result.reason));
      if (failed.length === results.length) throw new TelegramError(failed.join('; '));
      return { delivered: results.length - failed.length, failed };
    },

    async botUsername(): Promise<string> {
      const bot = await callForResult<{ username: string }>('getMe');
      return bot.username;
    },

    async recentChats(): Promise<TelegramChat[]> {
      const updates = await callForResult<Update[]>('getUpdates', { limit: UPDATES_LIMIT });
      return uniqueChats(updates);
    },
  };
}

function messagePayload(chat: ChatTarget, html: string): object {
  return {
    chat_id: chat.chatId,
    ...(chat.topicId ? { message_thread_id: chat.topicId } : {}),
    text: html,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
  };
}

function uniqueChats(updates: Update[]): TelegramChat[] {
  const chatsById = new Map<number, TelegramChat>();
  for (const update of updates) {
    const chat = update.message?.chat ?? update.channel_post?.chat ?? update.my_chat_member?.chat;
    if (chat) chatsById.set(chat.id, chat);
  }
  return [...chatsById.values()];
}

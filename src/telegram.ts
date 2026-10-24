import { errorMessage } from './errors.ts';

export interface ChatTarget {
  chatId: string;
  topicId?: number | undefined;
}

export interface DeliveryResult {
  delivered: number;
  failed: string[];
}

export interface Notifier {
  send(html: string): Promise<DeliveryResult>;
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
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
}

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

type SendAttempt = { sent: true } | { sent: false; retryable: boolean; reason: string; retryAfterMs?: number | undefined };

interface Update {
  message?: { chat: TelegramChat };
  channel_post?: { chat: TelegramChat };
  my_chat_member?: { chat: TelegramChat };
}

const DEFAULT_API_URL = 'https://api.telegram.org';
const DEFAULT_MAX_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 10_000;
const RETRY_BACKOFF_MS = 500;
const MAX_FLOOD_WAIT_SECONDS = 10;
const UPDATES_LIMIT = 100;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_ERROR = 500;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createTelegram(options: TelegramOptions) {
  const {
    token,
    chats,
    apiUrl = DEFAULT_API_URL,
    fetch: fetchImpl = globalThis.fetch,
    sleep = delay,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
  } = options;

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

  async function attemptSend(payload: object): Promise<SendAttempt> {
    try {
      const { status, reply } = await call('sendMessage', payload);
      if (reply.ok) return { sent: true };
      return { sent: false, retryable: isRetryableStatus(status), reason: reply.description ?? `HTTP ${status}`, retryAfterMs: floodWaitMs(reply) };
    } catch (error) {
      return { sent: false, retryable: true, reason: errorMessage(error) };
    }
  }

  async function sendToChat(chat: ChatTarget, html: string): Promise<void> {
    const payload = messagePayload(chat, html);
    for (let attempt = 1; ; attempt++) {
      const result = await attemptSend(payload);
      if (result.sent) return;
      if (!result.retryable || attempt >= maxAttempts) throw new TelegramError(`chat ${chat.chatId}: ${result.reason}`);
      await sleep(result.retryAfterMs ?? RETRY_BACKOFF_MS * attempt);
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

function isRetryableStatus(status: number): boolean {
  return status === HTTP_TOO_MANY_REQUESTS || status >= HTTP_SERVER_ERROR;
}

function floodWaitMs(reply: ApiReply<unknown>): number | undefined {
  const seconds = reply.parameters?.retry_after;
  return seconds ? Math.min(seconds, MAX_FLOOD_WAIT_SECONDS) * 1000 : undefined;
}

function uniqueChats(updates: Update[]): TelegramChat[] {
  const chatsById = new Map<number, TelegramChat>();
  for (const update of updates) {
    const chat = update.message?.chat ?? update.channel_post?.chat ?? update.my_chat_member?.chat;
    if (chat) chatsById.set(chat.id, chat);
  }
  return [...chatsById.values()];
}

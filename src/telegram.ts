export interface ChatTarget {
  chatId: string;
  /** Topic id in a forum supergroup, so leads land in a specific thread. */
  threadId?: number | undefined;
}

export interface DeliveryResult {
  delivered: number;
  /** Error descriptions for chats that did not receive the message. */
  failed: string[];
}

/** Anything that can deliver a formatted lead. Tests pass a fake one. */
export interface Notifier {
  send(html: string): Promise<DeliveryResult>;
}

export class TelegramError extends Error {
  override name = 'TelegramError';
}

interface ApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  parameters?: { retry_after?: number };
}

export interface TelegramOptions {
  token: string;
  chats: ChatTarget[];
  fetch?: typeof fetch;
  apiBase?: string;
  /** Injected in tests to skip real waiting. */
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
}

export interface TelegramChat {
  id: number;
  type: string;
  title?: string;
  username?: string;
  first_name?: string;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createTelegram(options: TelegramOptions) {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const apiBase = options.apiBase ?? 'https://api.telegram.org';
  const sleep = options.sleep ?? wait;
  const maxAttempts = options.maxAttempts ?? 3;

  async function call<T>(method: string, payload: object): Promise<{ status: number; body: ApiResponse<T> }> {
    const response = await fetchImpl(`${apiBase}/bot${options.token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await response.json().catch(() => ({ ok: false, description: `HTTP ${response.status}` }))) as ApiResponse<T>;
    return { status: response.status, body };
  }

  async function sendTo(chat: ChatTarget, text: string): Promise<void> {
    const payload = {
      chat_id: chat.chatId,
      ...(chat.threadId ? { message_thread_id: chat.threadId } : {}),
      text,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    };

    for (let attempt = 1; ; attempt++) {
      let result: Awaited<ReturnType<typeof call>>;
      try {
        result = await call('sendMessage', payload);
      } catch (error) {
        if (attempt >= maxAttempts) throw new TelegramError(`chat ${chat.chatId}: ${(error as Error).message}`);
        await sleep(500 * attempt);
        continue;
      }

      if (result.body.ok) return;

      // 429 = flood control (Telegram says how long to wait), 5xx = their side.
      const retryable = result.status === 429 || result.status >= 500;
      if (!retryable || attempt >= maxAttempts) {
        throw new TelegramError(`chat ${chat.chatId}: ${result.body.description ?? `HTTP ${result.status}`}`);
      }
      const retryAfter = result.body.parameters?.retry_after;
      await sleep(retryAfter ? Math.min(retryAfter, 10) * 1000 : 500 * attempt);
    }
  }

  return {
    /** Sends to every chat. Succeeds if at least one chat received the message. */
    async send(html: string): Promise<DeliveryResult> {
      const results = await Promise.allSettled(options.chats.map((chat) => sendTo(chat, html)));
      const failed = results.flatMap((r) => (r.status === 'rejected' ? [(r.reason as Error).message] : []));
      if (failed.length === results.length) throw new TelegramError(failed.join('; '));
      return { delivered: results.length - failed.length, failed };
    },

    /** Checks the token and returns the bot's @username. */
    async getMe(): Promise<string> {
      const { body } = await call<{ username: string }>('getMe', {});
      if (!body.ok || !body.result) throw new TelegramError(body.description ?? 'getMe failed');
      return body.result.username;
    },

    /** Chats that have recently messaged the bot — used to find chat ids. */
    async recentChats(): Promise<TelegramChat[]> {
      type Update = { message?: { chat: TelegramChat }; channel_post?: { chat: TelegramChat }; my_chat_member?: { chat: TelegramChat } };
      const { body } = await call<Update[]>('getUpdates', { limit: 100 });
      if (!body.ok || !body.result) throw new TelegramError(body.description ?? 'getUpdates failed');
      const chats = new Map<number, TelegramChat>();
      for (const update of body.result) {
        const chat = update.message?.chat ?? update.channel_post?.chat ?? update.my_chat_member?.chat;
        if (chat) chats.set(chat.id, chat);
      }
      return [...chats.values()];
    },
  };
}

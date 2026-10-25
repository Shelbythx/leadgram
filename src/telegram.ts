import { type Attempt, DEFAULT_RETRY_POLICY, isRetryableStatus, retry, type RetryPolicy, serverRequestedWaitMs } from './delivery/retry.ts';
import { errorMessage } from './errors.ts';

export interface ChatTarget {
  chatId: string;
  topicId?: number | undefined;
}

export interface UploadFile {
  fileName: string;
  mimeType: string;
  content: Blob;
}

export interface DeliveryResult {
  delivered: number;
  problems: string[];
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

interface SentMessage {
  message_id: number;
}

interface Update {
  message?: { chat: TelegramChat };
  channel_post?: { chat: TelegramChat };
  my_chat_member?: { chat: TelegramChat };
}

type MediaKind = 'photo' | 'document';

interface UploadBatch {
  method: 'sendPhoto' | 'sendDocument' | 'sendMediaGroup';
  kind: MediaKind;
  files: UploadFile[];
}

const DEFAULT_API_URL = 'https://api.telegram.org';
const REQUEST_TIMEOUT_MS = 10_000;
const UPLOAD_TIMEOUT_MS = 60_000;
const UPDATES_LIMIT = 100;
const MAX_MEDIA_GROUP_SIZE = 10;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const SINGLE_UPLOAD_METHOD = { photo: 'sendPhoto', document: 'sendDocument' } as const;

export function createTelegram(options: TelegramOptions) {
  const { token, chats, apiUrl = DEFAULT_API_URL, fetch: fetchImpl = globalThis.fetch } = options;
  const retryPolicy = { ...DEFAULT_RETRY_POLICY, ...options.retryPolicy };

  async function request<T>(method: string, body: string | FormData, timeoutMs: number): Promise<ApiResponse<T>> {
    const response = await fetchImpl(`${apiUrl}/bot${token}/${method}`, {
      method: 'POST',
      headers: typeof body === 'string' ? { 'content-type': 'application/json' } : undefined,
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const reply = await response.json().catch(() => ({ ok: false, description: `HTTP ${response.status}` }));
    return { status: response.status, reply: reply as ApiReply<T> };
  }

  const callJson = <T>(method: string, payload: object = {}) => request<T>(method, JSON.stringify(payload), REQUEST_TIMEOUT_MS);

  async function attempt<T>(send: () => Promise<ApiResponse<T>>): Promise<Attempt<T>> {
    try {
      const { status, reply } = await send();
      if (reply.ok && reply.result !== undefined) return { ok: true, value: reply.result };
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

  const callWithRetry = <T>(send: () => Promise<ApiResponse<T>>) => retry(() => attempt(send), retryPolicy);

  async function callForResult<T>(method: string, payload?: object): Promise<T> {
    const { reply } = await callJson<T>(method, payload);
    if (!reply.ok || reply.result === undefined) throw new TelegramError(reply.description ?? `${method} failed`);
    return reply.result;
  }

  async function sendMessage(chat: ChatTarget, html: string): Promise<SentMessage> {
    try {
      return await callWithRetry(() => callJson<SentMessage>('sendMessage', messagePayload(chat, html)));
    } catch (error) {
      throw new TelegramError(`chat ${chat.chatId}: ${errorMessage(error)}`);
    }
  }

  async function sendFiles(chat: ChatTarget, files: readonly UploadFile[], replyTo: SentMessage): Promise<string[]> {
    const problems: string[] = [];
    for (const batch of uploadBatches(files)) {
      try {
        await callWithRetry(() => request(batch.method, uploadForm(chat, batch, replyTo), UPLOAD_TIMEOUT_MS));
      } catch (error) {
        problems.push(`chat ${chat.chatId}: files: ${errorMessage(error)}`);
      }
    }
    return problems;
  }

  async function sendToChat(chat: ChatTarget, html: string, files: readonly UploadFile[]): Promise<string[]> {
    const message = await sendMessage(chat, html);
    return sendFiles(chat, files, message);
  }

  return {
    async send(html: string, files: readonly UploadFile[] = []): Promise<DeliveryResult> {
      const results = await Promise.allSettled(chats.map((chat) => sendToChat(chat, html, files)));
      const delivered = results.filter((result) => result.status === 'fulfilled').length;
      const problems = results.flatMap((result) => (result.status === 'fulfilled' ? result.value : [errorMessage(result.reason)]));
      if (delivered === 0) throw new TelegramError(problems.join('; '));
      return { delivered, problems };
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
    ...chatTarget(chat),
    text: html,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
  };
}

function chatTarget(chat: ChatTarget): Record<string, string | number> {
  return chat.topicId ? { chat_id: chat.chatId, message_thread_id: chat.topicId } : { chat_id: chat.chatId };
}

function uploadBatches(files: readonly UploadFile[]): UploadBatch[] {
  const filesByKind: Record<MediaKind, UploadFile[]> = {
    photo: files.filter(isPhoto),
    document: files.filter((file) => !isPhoto(file)),
  };
  return (['photo', 'document'] as const).flatMap((kind) =>
    chunks(filesByKind[kind], MAX_MEDIA_GROUP_SIZE).map((group) => ({
      kind,
      files: group,
      method: group.length === 1 ? SINGLE_UPLOAD_METHOD[kind] : 'sendMediaGroup',
    })),
  );
}

function uploadForm(chat: ChatTarget, batch: UploadBatch, replyTo: SentMessage): FormData {
  const form = new FormData();
  for (const [name, value] of Object.entries(chatTarget(chat))) form.append(name, String(value));
  form.append('reply_parameters', JSON.stringify({ message_id: replyTo.message_id, allow_sending_without_reply: true }));

  const isGroup = batch.method === 'sendMediaGroup';
  const fieldName = (index: number) => (isGroup ? `file${index}` : batch.kind);
  batch.files.forEach((file, index) => form.append(fieldName(index), file.content, file.fileName));
  if (isGroup) form.append('media', JSON.stringify(batch.files.map((_, index) => ({ type: batch.kind, media: `attach://${fieldName(index)}` }))));
  return form;
}

function isPhoto(file: UploadFile): boolean {
  return PHOTO_TYPES.has(file.mimeType) && file.content.size <= MAX_PHOTO_BYTES;
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let start = 0; start < items.length; start += size) result.push(items.slice(start, start + size));
  return result;
}

function uniqueChats(updates: Update[]): TelegramChat[] {
  const chatsById = new Map<number, TelegramChat>();
  for (const update of updates) {
    const chat = update.message?.chat ?? update.channel_post?.chat ?? update.my_chat_member?.chat;
    if (chat) chatsById.set(chat.id, chat);
  }
  return [...chatsById.values()];
}

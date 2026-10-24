import { errorMessage, exitWithError } from './errors.ts';
import { createTelegram, type TelegramChat } from './telegram.ts';

const CHAT_ID_COLUMN_WIDTH = 16;
const CHAT_TYPE_COLUMN_WIDTH = 11;

async function main(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) exitWithError('Set TELEGRAM_BOT_TOKEN in .env first (create a bot with @BotFather).');

  const telegram = createTelegram({ token, chats: [], apiUrl: process.env.TELEGRAM_API_URL || undefined });
  try {
    const bot = await telegram.botUsername();
    const chats = await telegram.recentChats();
    console.log(chats.length > 0 ? chatList(bot, chats) : startInstructions(bot));
  } catch (error) {
    exitWithError(
      `Telegram error: ${errorMessage(error)}\n` +
        'If a webhook is set for this bot, getUpdates does not work — remove it or find the id another way.',
    );
  }
}

function chatList(bot: string, chats: TelegramChat[]): string {
  const rows = chats.map((chat) => `  ${String(chat.id).padEnd(CHAT_ID_COLUMN_WIDTH)} ${chat.type.padEnd(CHAT_TYPE_COLUMN_WIDTH)} ${chatName(chat)}`);
  return [`Chats that recently wrote to @${bot}:`, '', ...rows, '', 'Put the ids you need into TELEGRAM_CHAT_IDS, separated by commas.'].join('\n');
}

function chatName(chat: TelegramChat): string {
  return chat.title ?? (chat.username ? `@${chat.username}` : (chat.first_name ?? ''));
}

function startInstructions(bot: string): string {
  return `No messages yet.

1. Open https://t.me/${bot} and press Start
   — or add @${bot} to a group and send any message there.
2. Run \`npm run chat-id\` again.`;
}

await main();

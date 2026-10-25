import { readFile } from 'node:fs/promises';
import { type ServerType, serve } from '@hono/node-server';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context } from 'hono';
import { createApp } from './app.ts';
import { ANY_ORIGIN, type Config, ConfigError, loadConfig } from './config.ts';
import { createDestinations } from './delivery/destinations.ts';
import { errorMessage, exitWithError } from './errors.ts';
import { clientIpResolver } from './http/request.ts';
import { createLogger } from './log.ts';
import { createTelegram } from './telegram.ts';

const PROJECT_ROOT = new URL('../', import.meta.url);
const WIDGET_FILE = new URL('dist/widget/leadgram.js', PROJECT_ROOT);
const DEMO_FILE = new URL('examples/index.html', PROJECT_ROOT);
const SHUTDOWN_TIMEOUT_MS = 5_000;

const log = createLogger();

async function main(): Promise<void> {
  const config = loadConfigOrExit();
  const telegram = createTelegram({ token: config.telegramToken, chats: config.chats, apiUrl: config.telegramApiUrl });
  const bot = await telegram.botUsername().catch((error) => exitWithError(`Telegram did not accept the bot token: ${errorMessage(error)}`));

  const widgetScript = await readOptionalFile(WIDGET_FILE);
  const demoHtml = config.demoPage ? await readOptionalFile(DEMO_FILE) : undefined;
  warnAboutSetup(config, widgetScript);

  const destinations = createDestinations(config, telegram, log);
  const app = createApp({
    config,
    destinations,
    logger: log,
    clientIp: clientIpResolver(config.trustProxy, socketAddress),
    widgetScript,
    demoHtml,
  });

  const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, ({ port }) => {
    log.info('server.started', {
      url: `http://localhost:${port}`,
      bot: `@${bot}`,
      chats: config.chats.length,
      destinations: destinations.map(({ name }) => name).join(', '),
      demo: demoHtml ? `http://localhost:${port}/demo` : undefined,
    });
  });
  stopGracefully(server);
}

function loadConfigOrExit(): Config {
  try {
    return loadConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) exitWithError(`${error.message}\n\nCopy .env.example to .env and fill it in.`);
    throw error;
  }
}

function readOptionalFile(file: URL): Promise<string | undefined> {
  return readFile(file, 'utf8').catch(() => undefined);
}

function warnAboutSetup(config: Config, widgetScript: string | undefined): void {
  if (!widgetScript) log.warn('widget.missing', { hint: 'run `npm run build:widget` to serve /leadgram.js' });
  if (config.allowedOrigins.includes(ANY_ORIGIN)) log.warn('config.any_origin', { hint: 'set ALLOWED_ORIGINS to your site in production' });
}

function socketAddress(c: Context): string | undefined {
  return getConnInfo(c).remote.address;
}

function stopGracefully(server: ServerType): void {
  const stop = (signal: NodeJS.Signals) => {
    log.info('server.stopping', { signal });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), SHUTDOWN_TIMEOUT_MS).unref();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

await main();

export type LogFields = Record<string, string | number | boolean | undefined>;

export interface Logger {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

type LogLevel = keyof Logger;

export function createLogger(write: (line: string) => void = console.log): Logger {
  const logAt = (level: LogLevel) => (event: string, fields: LogFields = {}) =>
    write(JSON.stringify({ time: new Date().toISOString(), level, event, ...fields }));

  return { info: logAt('info'), warn: logAt('warn'), error: logAt('error') };
}

export const silentLogger: Logger = { info() {}, warn() {}, error() {} };

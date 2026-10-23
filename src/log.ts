export type LogFields = Record<string, string | number | boolean | undefined>;

export interface Logger {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

/**
 * One JSON object per line, ready for Docker / Render / Railway log viewers.
 * Never pass personal data (names, phones, message text) into it.
 */
export function createLogger(write: (line: string) => void = (line) => console.log(line)): Logger {
  const log = (level: string) => (event: string, fields: LogFields = {}) =>
    write(JSON.stringify({ time: new Date().toISOString(), level, event, ...fields }));
  return { info: log('info'), warn: log('warn'), error: log('error') };
}

export const silentLogger: Logger = { info() {}, warn() {}, error() {} };

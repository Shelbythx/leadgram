import type { HonoRequest } from 'hono';
import { ANY_ORIGIN } from '../config.ts';

export type OriginPolicy = ReturnType<typeof createOriginPolicy>;

export function createOriginPolicy(allowedOrigins: readonly string[]) {
  const allowsAnyOrigin = allowedOrigins.includes(ANY_ORIGIN);

  function isAllowed(origin: string, req: HonoRequest): boolean {
    return allowsAnyOrigin || allowedOrigins.includes(origin) || origin === new URL(req.url).origin;
  }

  function trustedReferer(req: HonoRequest): string | undefined {
    const referer = req.header('referer');
    if (!referer || !URL.canParse(referer)) return undefined;
    return isAllowed(new URL(referer).origin, req) ? referer : undefined;
  }

  return { isAllowed, trustedReferer };
}

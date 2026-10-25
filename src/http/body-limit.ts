import type { Context, MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { AttachmentRules } from '../lead/attachments.ts';
import { isMultipart } from './request.ts';

const TEXT_BODY_BYTES = 16 * 1024;
const UPLOAD_OVERHEAD_BYTES = 64 * 1024;

export function limitBodySize(attachments: AttachmentRules, onTooLarge: (c: Context) => Response): MiddlewareHandler {
  const textLimit = bodyLimit({ maxSize: TEXT_BODY_BYTES, onError: onTooLarge });
  if (attachments.maxFiles === 0) return textLimit;

  const uploadLimit = bodyLimit({ maxSize: attachments.maxFiles * attachments.maxFileBytes + UPLOAD_OVERHEAD_BYTES, onError: onTooLarge });
  return (c, next) => (isMultipart(c.req) ? uploadLimit : textLimit)(c, next);
}

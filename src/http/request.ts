import type { Context, HonoRequest } from 'hono';
import type { FormFields } from '../lead/fields.ts';

export type ClientIpResolver = (c: Context) => string;

const JSON_TYPE = 'application/json';
const FORM_TYPES = ['application/x-www-form-urlencoded', 'multipart/form-data'];
const MAX_FIELDS = 50;
const MAX_FIELD_NAME_LENGTH = 64;
const UNKNOWN_IP = 'unknown';

export function prefersJson(req: HonoRequest): boolean {
  return [req.header('accept'), req.header('content-type')].some((value) => value?.includes(JSON_TYPE));
}

export async function readFormFields(req: HonoRequest): Promise<FormFields | undefined> {
  const contentType = req.header('content-type') ?? '';
  try {
    if (contentType.includes(JSON_TYPE)) return fieldsFromJson(await req.json());
    if (FORM_TYPES.some((type) => contentType.includes(type))) return toFormFields(Object.entries(await req.parseBody({ all: true })));
    return undefined;
  } catch {
    return undefined;
  }
}

export function clientIpResolver(trustProxy: boolean, socketAddress: (c: Context) => string | undefined): ClientIpResolver {
  return (c) => (trustProxy ? forwardedClientIp(c.req) : undefined) ?? socketAddress(c) ?? UNKNOWN_IP;
}

function forwardedClientIp(req: HonoRequest): string | undefined {
  const firstForwarded = req.header('x-forwarded-for')?.split(',')[0]?.trim();
  return firstForwarded || req.header('x-real-ip') || undefined;
}

function fieldsFromJson(body: unknown): FormFields | undefined {
  return isPlainObject(body) ? toFormFields(Object.entries(body)) : undefined;
}

function toFormFields(entries: Array<[string, unknown]>): FormFields {
  const fields: FormFields = {};
  for (const [name, raw] of entries.slice(0, MAX_FIELDS)) {
    const values = (Array.isArray(raw) ? raw : [raw]).filter(isScalar).map(String);
    if (values.length > 0) fields[name.slice(0, MAX_FIELD_NAME_LENGTH)] = values.join(', ');
  }
  return fields;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isScalar(value: unknown): value is string | number | boolean {
  return ['string', 'number', 'boolean'].includes(typeof value);
}

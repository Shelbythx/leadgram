import type { Context, HonoRequest } from 'hono';
import type { FormFields, Submission, UploadedFile } from '../lead/fields.ts';

export type ClientIpResolver = (c: Context) => string;

const JSON_TYPE = 'application/json';
const URL_ENCODED_TYPE = 'application/x-www-form-urlencoded';
const MULTIPART_TYPE = 'multipart/form-data';
const MAX_FIELDS = 50;
const MAX_FIELD_NAME_LENGTH = 64;
const UNKNOWN_IP = 'unknown';

export function prefersJson(req: HonoRequest): boolean {
  return [req.header('accept'), req.header('content-type')].some((value) => value?.includes(JSON_TYPE));
}

export function isMultipart(req: HonoRequest): boolean {
  return (req.header('content-type') ?? '').includes(MULTIPART_TYPE);
}

export async function readSubmission(req: HonoRequest): Promise<Submission | undefined> {
  const contentType = req.header('content-type') ?? '';
  try {
    if (contentType.includes(JSON_TYPE)) return submissionFromJson(await req.json());
    if (contentType.includes(URL_ENCODED_TYPE) || isMultipart(req)) return submissionFromForm(Object.entries(await req.parseBody({ all: true })));
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

function submissionFromJson(body: unknown): Submission | undefined {
  return isPlainObject(body) ? { fields: toFormFields(Object.entries(body)), files: [] } : undefined;
}

function submissionFromForm(entries: Array<[string, unknown]>): Submission {
  return { fields: toFormFields(entries), files: uploadedFiles(entries) };
}

function uploadedFiles(entries: Array<[string, unknown]>): UploadedFile[] {
  return entries.flatMap(([fieldName, raw]) =>
    (Array.isArray(raw) ? raw : [raw]).filter(isFile).map((file) => ({ fieldName, file })),
  );
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

function isFile(value: unknown): value is File {
  return value instanceof File;
}

function isScalar(value: unknown): value is string | number | boolean {
  return ['string', 'number', 'boolean'].includes(typeof value);
}

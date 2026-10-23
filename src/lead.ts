import * as z from 'zod';
import type { Messages } from './i18n.ts';

/** Raw form fields after parsing the request body. */
export type Fields = Record<string, string>;

export interface Lead {
  name?: string | undefined;
  phone?: string | undefined;
  email?: string | undefined;
  message?: string | undefined;
  /** Any other fields the form had, e.g. [['service', 'Haircut']]. */
  extra: Array<[key: string, value: string]>;
  /** Optional form name from a hidden `_form` field, e.g. "Callback". */
  form?: string | undefined;
  /** Page the form was submitted from. */
  page?: string | undefined;
}

const KNOWN_FIELDS = new Set(['name', 'phone', 'email', 'message']);
const MAX_EXTRA_FIELDS = 10;

/**
 * Normalises phone numbers people actually type. Ukrainian local formats
 * (`067 123 45 67`, `8 067…`, `380…`) become `+380671234567`; anything with an
 * explicit `+` or `00` prefix is kept international. Numbers we cannot place
 * confidently are returned tidied but otherwise as typed.
 */
export function normalizePhone(input: string): { valid: boolean; value: string } {
  const typed = input.trim().replace(/\s+/g, ' ');
  const digits = typed.replace(/\D/g, '');
  const valid = /^\+?[\d\s().-]+$/.test(typed) && digits.length >= 7 && digits.length <= 15;
  if (!valid) return { valid, value: typed };

  if (typed.startsWith('+')) return { valid, value: `+${digits}` };
  if (digits.startsWith('00')) return { valid, value: `+${digits.slice(2)}` };
  if (digits.length === 10 && digits.startsWith('0')) return { valid, value: `+38${digits}` };
  if (digits.length === 11 && digits.startsWith('80')) return { valid, value: `+3${digits}` };
  if (digits.length === 12 && digits.startsWith('380')) return { valid, value: `+${digits}` };
  return { valid, value: typed };
}

export function createLeadSchema(t: Messages) {
  const text = (max: number) =>
    z
      .string()
      .trim()
      .max(max, { error: t.errors.tooLong })
      .optional()
      .transform((value) => value || undefined);

  return z
    .object({
      name: text(100),
      phone: text(40)
        .refine((value) => value === undefined || normalizePhone(value).valid, { error: t.errors.invalidPhone })
        .transform((value) => (value === undefined ? undefined : normalizePhone(value).value)),
      email: text(200).refine((value) => value === undefined || z.email().safeParse(value).success, {
        error: t.errors.invalidEmail,
      }),
      message: text(2000),
    })
    .refine((lead) => lead.phone || lead.email, { error: t.errors.contactRequired, path: ['phone'] });
}

export type LeadSchema = ReturnType<typeof createLeadSchema>;

export type ParseResult = { ok: true; lead: Lead } | { ok: false; fields: Record<string, string> };

export function parseLead(fields: Fields, schema: LeadSchema): ParseResult {
  const result = schema.safeParse(fields);
  if (!result.success) {
    const errors: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = String(issue.path[0] ?? 'form');
      errors[key] ??= issue.message;
    }
    return { ok: false, fields: errors };
  }

  const extra = Object.entries(fields)
    .filter(([key, value]) => !KNOWN_FIELDS.has(key) && !key.startsWith('_') && value.trim() !== '')
    .slice(0, MAX_EXTRA_FIELDS)
    .map(([key, value]): [string, string] => [key.slice(0, 40), value.trim().slice(0, 500)]);

  const form = fields._form?.trim().slice(0, 60) || undefined;
  return { ok: true, lead: { ...result.data, extra, form } };
}

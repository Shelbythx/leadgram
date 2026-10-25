import * as z from 'zod';
import type { LocaleTexts } from '../i18n.ts';
import { type Attachment, type AttachmentRules, parseAttachments } from './attachments.ts';
import { type FormFields, isServiceField, SERVICE_FIELD, type Submission } from './fields.ts';
import { normalizePhone } from './phone.ts';

export type ExtraField = [name: string, value: string];

export interface Lead {
  name?: string | undefined;
  phone?: string | undefined;
  email?: string | undefined;
  message?: string | undefined;
  extra: ExtraField[];
  formName?: string | undefined;
  page?: string | undefined;
  attachments: Attachment[];
}

export type FieldErrors = Record<string, string>;

export type ParsedLead = { ok: true; lead: Lead } | { ok: false; errors: FieldErrors };

export type LeadParser = (submission: Submission) => Promise<ParsedLead>;

const MAX_LENGTH = {
  name: 100,
  phone: 40,
  email: 200,
  message: 2000,
  formName: 60,
  extraFieldName: 40,
  extraFieldValue: 500,
} as const;

const MAX_EXTRA_FIELDS = 10;
const CONTACT_FIELDS = new Set(['name', 'phone', 'email', 'message']);
const FORM_LEVEL_ERROR_KEY = 'form';
const EMAIL = z.email();

function createLeadSchema(texts: LocaleTexts) {
  const optionalText = (maxLength: number) =>
    z
      .string()
      .trim()
      .max(maxLength, { error: texts.errors.tooLong })
      .optional()
      .transform((value) => value || undefined);

  const phone = optionalText(MAX_LENGTH.phone).transform((value, context) => {
    if (value === undefined) return undefined;
    const normalized = normalizePhone(value);
    if (normalized) return normalized;
    context.addIssue({ code: 'custom', message: texts.errors.invalidPhone });
    return z.NEVER;
  });

  const email = optionalText(MAX_LENGTH.email).refine((value) => value === undefined || EMAIL.safeParse(value).success, {
    error: texts.errors.invalidEmail,
  });

  return z
    .object({ name: optionalText(MAX_LENGTH.name), phone, email, message: optionalText(MAX_LENGTH.message) })
    .refine((lead) => lead.phone || lead.email, { error: texts.errors.contactRequired, path: ['phone'] });
}

export function createLeadParser(texts: LocaleTexts, attachmentRules: AttachmentRules): LeadParser {
  const schema = createLeadSchema(texts);

  return async ({ fields, files }) => {
    const details = schema.safeParse(fields);
    const attachments = await parseAttachments(files, attachmentRules, texts.attachmentErrors);

    if (!details.success || !attachments.ok) {
      const detailErrors = details.success ? {} : firstErrorPerField(details.error.issues);
      const attachmentErrors = attachments.ok ? {} : attachments.errors;
      return { ok: false, errors: { ...detailErrors, ...attachmentErrors } };
    }

    return {
      ok: true,
      lead: {
        ...details.data,
        extra: extraFields(fields),
        formName: optionalTrimmed(fields[SERVICE_FIELD.formName], MAX_LENGTH.formName),
        page: optionalTrimmed(fields[SERVICE_FIELD.page]),
        attachments: attachments.attachments,
      },
    };
  };
}

function firstErrorPerField(issues: Array<{ path: PropertyKey[]; message: string }>): FieldErrors {
  const errors: FieldErrors = {};
  for (const { path, message } of issues) {
    errors[String(path[0] ?? FORM_LEVEL_ERROR_KEY)] ??= message;
  }
  return errors;
}

function extraFields(fields: FormFields): ExtraField[] {
  return Object.entries(fields)
    .filter(([name, value]) => !CONTACT_FIELDS.has(name) && !isServiceField(name) && value.trim() !== '')
    .slice(0, MAX_EXTRA_FIELDS)
    .map(([name, value]) => [name.slice(0, MAX_LENGTH.extraFieldName), value.trim().slice(0, MAX_LENGTH.extraFieldValue)]);
}

function optionalTrimmed(value: string | undefined, maxLength?: number): string | undefined {
  return value?.trim().slice(0, maxLength) || undefined;
}

import type { LocaleTexts } from '../i18n.ts';
import type { UploadedFile } from './fields.ts';
import { detectFileType } from './file-type.ts';

export interface Attachment {
  fieldName: string;
  fileName: string;
  mimeType: string;
  content: Blob;
}

export interface AttachmentRules {
  maxFiles: number;
  maxFileBytes: number;
}

export type ParsedAttachments = { ok: true; attachments: Attachment[] } | { ok: false; errors: Record<string, string> };

type AttachmentErrors = LocaleTexts['attachmentErrors'];

const BYTES_PER_MEGABYTE = 1024 * 1024;
const MAX_FILE_NAME_LENGTH = 100;
const DEFAULT_FILE_NAME = 'file';

export async function parseAttachments(files: UploadedFile[], rules: AttachmentRules, texts: AttachmentErrors): Promise<ParsedAttachments> {
  const [first] = files;
  if (!first) return { ok: true, attachments: [] };
  if (rules.maxFiles === 0) return { ok: false, errors: { [first.fieldName]: texts.notAccepted } };
  if (files.length > rules.maxFiles) return { ok: false, errors: { [first.fieldName]: texts.tooMany(rules.maxFiles) } };

  const attachments: Attachment[] = [];
  const errors: Record<string, string> = {};
  for (const [index, { fieldName, file }] of files.entries()) {
    if (file.size > rules.maxFileBytes) {
      errors[fieldName] ??= texts.tooLarge(megabytes(rules.maxFileBytes));
      continue;
    }
    const type = await detectFileType(file);
    if (!type) {
      errors[fieldName] ??= texts.unsupportedType;
      continue;
    }
    attachments.push({ fieldName, fileName: safeFileName(file.name, type.extension, index), mimeType: type.mimeType, content: file });
  }

  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, attachments };
}

export function megabytes(bytes: number): number {
  return Number((bytes / BYTES_PER_MEGABYTE).toFixed(1));
}

export function bytesFromMegabytes(value: number): number {
  return Math.round(value * BYTES_PER_MEGABYTE);
}

function safeFileName(original: string, extension: string, index: number): string {
  const baseName = original.split(/[\\/]/).pop() ?? '';
  const stem = baseName
    .replace(/\.[^.]*$/, '')
    .replace(/[\u0000-\u001f<>:"|?*]/g, '')
    .trim()
    .slice(0, MAX_FILE_NAME_LENGTH);
  return `${stem || `${DEFAULT_FILE_NAME}-${index + 1}`}.${extension}`;
}

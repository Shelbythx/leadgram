import { describe, expect, it } from 'vitest';
import { TEXTS } from '../src/i18n.ts';
import type { FormFields, UploadedFile } from '../src/lead/fields.ts';
import { createLeadParser } from '../src/lead/lead.ts';
import { fileWith, JPEG_HEADER, TEXT_HEADER } from './support/files.ts';

const noAttachments = { maxFiles: 0, maxFileBytes: 0 };
const parseUk = createLeadParser(TEXTS.uk, noAttachments);
const parse = (fields: FormFields, files: UploadedFile[] = []) => parseUk({ fields, files });

describe('lead parser', () => {
  it('accepts a phone-only lead and normalises it', async () => {
    expect(await parse({ phone: ' 067 123 45 67 ', name: '  Олена ' })).toEqual({
      ok: true,
      lead: { name: 'Олена', phone: '+380671234567', extra: [], attachments: [] },
    });
  });

  it('needs a phone or an email', async () => {
    expect(await parse({ name: 'Олена', message: 'Hi' })).toEqual({ ok: false, errors: { phone: TEXTS.uk.errors.contactRequired } });
  });

  it('reports invalid fields in the configured language', async () => {
    const parseEn = createLeadParser(TEXTS.en, noAttachments);
    expect(await parseEn({ fields: { phone: 'abc', email: 'not-an-email' }, files: [] })).toEqual({
      ok: false,
      errors: { phone: TEXTS.en.errors.invalidPhone, email: TEXTS.en.errors.invalidEmail },
    });
  });

  it('rejects overly long text', async () => {
    expect(await parse({ email: 'a@b.co', message: 'x'.repeat(2001) })).toEqual({ ok: false, errors: { message: TEXTS.uk.errors.tooLong } });
  });

  it('reads the form name and source page from service fields', async () => {
    expect(await parse({ email: 'a@b.co', _form: ' Callback ', _page: 'https://cafe.example/' })).toMatchObject({
      ok: true,
      lead: { formName: 'Callback', page: 'https://cafe.example/' },
    });
  });

  it('keeps up to ten non-empty extra fields and skips service fields', async () => {
    const fields: Record<string, string> = { email: 'a@b.co', _t: '1', _gotcha: '', empty: ' ' };
    for (let i = 0; i < 15; i++) fields[`field${i}`] = `value ${i}`;

    const result = await parse(fields);
    if (!result.ok) throw new Error('expected a valid lead');
    expect(result.lead.extra).toHaveLength(10);
    expect(result.lead.extra[0]).toEqual(['field0', 'value 0']);
    expect(result.lead.extra.map(([name]) => name)).not.toContain('empty');
  });

  it('attaches valid files to the lead', async () => {
    const parseWithFiles = createLeadParser(TEXTS.uk, { maxFiles: 3, maxFileBytes: 1024 });
    const result = await parseWithFiles({ fields: { phone: '0671234567' }, files: [{ fieldName: 'photos', file: fileWith(JPEG_HEADER, 'hall.jpg') }] });

    expect(result).toMatchObject({ ok: true, lead: { attachments: [{ fieldName: 'photos', fileName: 'hall.jpg', mimeType: 'image/jpeg' }] } });
  });

  it('reports text and file problems together', async () => {
    const parseWithFiles = createLeadParser(TEXTS.uk, { maxFiles: 3, maxFileBytes: 1024 });
    const result = await parseWithFiles({ fields: { name: 'Олена' }, files: [{ fieldName: 'photos', file: fileWith(TEXT_HEADER, 'notes.txt') }] });

    expect(result).toEqual({
      ok: false,
      errors: { phone: TEXTS.uk.errors.contactRequired, photos: TEXTS.uk.attachmentErrors.unsupportedType },
    });
  });
});

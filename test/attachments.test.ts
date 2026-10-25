import { describe, expect, it } from 'vitest';
import { TEXTS } from '../src/i18n.ts';
import { bytesFromMegabytes, megabytes, parseAttachments } from '../src/lead/attachments.ts';
import type { UploadedFile } from '../src/lead/fields.ts';
import { fileWith, JPEG_HEADER, PDF_HEADER, TEXT_HEADER } from './support/files.ts';

const texts = TEXTS.uk.attachmentErrors;
const rules = { maxFiles: 2, maxFileBytes: bytesFromMegabytes(0.5) };
const upload = (file: File, fieldName = 'photos'): UploadedFile => ({ fieldName, file });

describe('parseAttachments', () => {
  it('accepts nothing when no files were sent', async () => {
    expect(await parseAttachments([], { maxFiles: 0, maxFileBytes: 0 }, texts)).toEqual({ ok: true, attachments: [] });
  });

  it('keeps the original file and names it after its real type', async () => {
    const photo = fileWith(JPEG_HEADER, 'IMG_2041.HEIC');
    const result = await parseAttachments([upload(photo)], rules, texts);

    expect(result).toEqual({ ok: true, attachments: [{ fieldName: 'photos', fileName: 'IMG_2041.jpg', mimeType: 'image/jpeg', content: photo }] });
  });

  it.each([
    ['C:\\fakepath\\menu.pdf', 'menu.pdf'],
    ['../../etc/menu.pdf', 'menu.pdf'],
    ['bad<>:"|?*name.pdf', 'badname.pdf'],
    ['.pdf', 'file-1.pdf'],
    ['', 'file-1.pdf'],
  ])('makes %j a safe file name', async (original, expected) => {
    const result = await parseAttachments([upload(fileWith(PDF_HEADER, original))], rules, texts);
    expect(result).toMatchObject({ ok: true, attachments: [{ fileName: expected }] });
  });

  it('refuses files when attachments are off', async () => {
    const result = await parseAttachments([upload(fileWith(JPEG_HEADER, 'a.jpg'))], { ...rules, maxFiles: 0 }, texts);
    expect(result).toEqual({ ok: false, errors: { photos: texts.notAccepted } });
  });

  it('limits the number of files', async () => {
    const files = [1, 2, 3].map((n) => upload(fileWith(JPEG_HEADER, `${n}.jpg`)));
    expect(await parseAttachments(files, rules, texts)).toEqual({ ok: false, errors: { photos: texts.tooMany(2) } });
  });

  it('treats an empty file as unsupported', async () => {
    expect(await parseAttachments([upload(new File([], 'empty.jpg'))], rules, texts)).toEqual({ ok: false, errors: { photos: texts.unsupportedType } });
  });

  it('reports oversized and unsupported files on their own fields', async () => {
    const files = [upload(fileWith(JPEG_HEADER, 'big.jpg', 600_000), 'photos'), upload(fileWith(TEXT_HEADER, 'notes.txt'), 'documents')];
    expect(await parseAttachments(files, rules, texts)).toEqual({
      ok: false,
      errors: { photos: texts.tooLarge(0.5), documents: texts.unsupportedType },
    });
  });
});

describe('megabyte helpers', () => {
  it('convert between bytes and megabytes', () => {
    expect(bytesFromMegabytes(10)).toBe(10_485_760);
    expect(megabytes(bytesFromMegabytes(2.5))).toBe(2.5);
  });
});

describe('attachment error texts', () => {
  it('use the right word form for one file', () => {
    expect(TEXTS.uk.attachmentErrors.tooMany(1)).toBe('Можна додати лише 1 файл');
    expect(TEXTS.uk.attachmentErrors.tooMany(3)).toBe('Можна додати до 3 файлів');
    expect(TEXTS.en.attachmentErrors.tooMany(1)).toBe('You can attach only 1 file');
  });
});

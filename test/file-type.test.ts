import { describe, expect, it } from 'vitest';
import { detectFileType } from '../src/lead/file-type.ts';
import { fileWith, HEIC_HEADER, JPEG_HEADER, PDF_HEADER, PNG_HEADER, TEXT_HEADER, WEBP_HEADER } from './support/files.ts';

describe('detectFileType', () => {
  it.each([
    [JPEG_HEADER, 'image/jpeg', 'jpg'],
    [PNG_HEADER, 'image/png', 'png'],
    [WEBP_HEADER, 'image/webp', 'webp'],
    [HEIC_HEADER, 'image/heic', 'heic'],
    [PDF_HEADER, 'application/pdf', 'pdf'],
  ])('recognises %s as %s', async (header, mimeType, extension) => {
    expect(await detectFileType(fileWith(header, 'upload'))).toEqual({ mimeType, extension });
  });

  it('trusts the content, not the name or the declared type', async () => {
    expect(await detectFileType(fileWith(TEXT_HEADER, 'photo.jpg', 100, 'image/jpeg'))).toBeUndefined();
    expect(await detectFileType(fileWith(PNG_HEADER, 'document.pdf', 100, 'application/pdf'))).toEqual({ mimeType: 'image/png', extension: 'png' });
  });

  it('rejects empty and unknown files', async () => {
    expect(await detectFileType(new File([], 'empty.jpg'))).toBeUndefined();
    expect(await detectFileType(fileWith([0x4d, 0x5a, 0x90, 0x00], 'setup.exe'))).toBeUndefined();
  });
});

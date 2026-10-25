export const JPEG_HEADER = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46];
export const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
export const PDF_HEADER = [...'%PDF-1.7\n'].map((character) => character.charCodeAt(0));
export const WEBP_HEADER = [...'RIFF\u0000\u0000\u0000\u0000WEBPVP8 '].map((character) => character.charCodeAt(0));
export const HEIC_HEADER = [0x00, 0x00, 0x00, 0x18, ...[...'ftypheic'].map((character) => character.charCodeAt(0))];
export const TEXT_HEADER = [...'just some text'].map((character) => character.charCodeAt(0));

export function fileWith(header: number[], name: string, size = header.length, type = ''): File {
  const bytes = new Uint8Array(Math.max(size, header.length));
  bytes.set(header);
  return new File([bytes], name, { type });
}

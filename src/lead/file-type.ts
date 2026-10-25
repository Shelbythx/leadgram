export interface FileType {
  mimeType: string;
  extension: string;
}

interface Signature extends FileType {
  matches(header: Uint8Array): boolean;
}

const HEADER_BYTES = 16;
const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx']);
const HEIF_BRANDS = new Set(['mif1', 'msf1']);

const SIGNATURES: Signature[] = [
  { mimeType: 'image/jpeg', extension: 'jpg', matches: (header) => startsWithBytes(header, [0xff, 0xd8, 0xff]) },
  { mimeType: 'image/png', extension: 'png', matches: (header) => startsWithBytes(header, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  { mimeType: 'image/webp', extension: 'webp', matches: (header) => ascii(header, 0, 4) === 'RIFF' && ascii(header, 8, 12) === 'WEBP' },
  { mimeType: 'image/heic', extension: 'heic', matches: (header) => hasIsoBrand(header, HEIC_BRANDS) },
  { mimeType: 'image/heif', extension: 'heif', matches: (header) => hasIsoBrand(header, HEIF_BRANDS) },
  { mimeType: 'application/pdf', extension: 'pdf', matches: (header) => ascii(header, 0, 5) === '%PDF-' },
];

export async function detectFileType(file: Blob): Promise<FileType | undefined> {
  const header = new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer());
  const signature = SIGNATURES.find(({ matches }) => matches(header));
  return signature && { mimeType: signature.mimeType, extension: signature.extension };
}

function startsWithBytes(header: Uint8Array, expected: number[]): boolean {
  return expected.every((byte, index) => header[index] === byte);
}

function ascii(header: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...header.subarray(start, end));
}

function hasIsoBrand(header: Uint8Array, brands: ReadonlySet<string>): boolean {
  return ascii(header, 4, 8) === 'ftyp' && brands.has(ascii(header, 8, 12));
}

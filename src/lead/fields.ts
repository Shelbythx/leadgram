export type FormFields = Record<string, string>;

export const SERVICE_FIELD = {
  formName: '_form',
  page: '_page',
  renderedAt: '_t',
  honeypot: '_gotcha',
} as const;

const SERVICE_FIELD_PREFIX = '_';

export function isServiceField(name: string): boolean {
  return name.startsWith(SERVICE_FIELD_PREFIX);
}

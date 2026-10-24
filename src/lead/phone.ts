const MIN_DIGITS = 7;
const MAX_DIGITS = 15;
const PHONE_CHARACTERS = /^\+?[\d\s().-]+$/;
const INTERNATIONAL_DIALING_PREFIX = '00';

const UKRAINIAN_LOCAL_FORMATS = [
  { length: 10, startsWith: '0', countryCodeToAdd: '+38' },
  { length: 11, startsWith: '80', countryCodeToAdd: '+3' },
  { length: 12, startsWith: '380', countryCodeToAdd: '+' },
];

export function normalizePhone(input: string): string | undefined {
  const typed = input.trim().replace(/\s+/g, ' ');
  const digits = typed.replace(/\D/g, '');
  if (!isPlausiblePhone(typed, digits)) return undefined;

  if (typed.startsWith('+')) return `+${digits}`;
  if (digits.startsWith(INTERNATIONAL_DIALING_PREFIX)) return `+${digits.slice(INTERNATIONAL_DIALING_PREFIX.length)}`;
  return toUkrainianInternational(digits) ?? typed;
}

function isPlausiblePhone(typed: string, digits: string): boolean {
  return PHONE_CHARACTERS.test(typed) && digits.length >= MIN_DIGITS && digits.length <= MAX_DIGITS;
}

function toUkrainianInternational(digits: string): string | undefined {
  const format = UKRAINIAN_LOCAL_FORMATS.find(({ length, startsWith }) => digits.length === length && digits.startsWith(startsWith));
  return format && `${format.countryCodeToAdd}${digits}`;
}

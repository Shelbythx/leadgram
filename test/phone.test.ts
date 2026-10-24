import { describe, expect, it } from 'vitest';
import { normalizePhone } from '../src/lead/phone.ts';

describe('normalizePhone', () => {
  it.each([
    ['067 123 45 67', '+380671234567'],
    ['(067) 123-45-67', '+380671234567'],
    ['+38 (067) 123 45 67', '+380671234567'],
    ['380671234567', '+380671234567'],
    ['8 067 123 45 67', '+380671234567'],
    ['0048 512 345 678', '+48512345678'],
    ['+1 (202) 555-0123', '+12025550123'],
  ])('%s → %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it('keeps numbers it cannot place confidently as typed', () => {
    expect(normalizePhone('202  555 0123')).toBe('202 555 0123');
  });

  it.each(['12345', 'call me maybe', '067 123 45 67 ext 5', '+1234567890123456'])('rejects %s', (input) => {
    expect(normalizePhone(input)).toBeUndefined();
  });
});

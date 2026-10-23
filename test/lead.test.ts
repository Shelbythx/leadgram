import { describe, expect, it } from 'vitest';
import { messages } from '../src/i18n.ts';
import { createLeadSchema, normalizePhone, parseLead } from '../src/lead.ts';
import { checkSpam } from '../src/spam.ts';

const schema = createLeadSchema(messages.uk);

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
    expect(normalizePhone(input)).toEqual({ valid: true, value: expected });
  });

  it('keeps numbers it cannot place confidently as typed', () => {
    expect(normalizePhone('202  555 0123')).toEqual({ valid: true, value: '202 555 0123' });
  });

  it.each(['12345', 'call me maybe', '067 123 45 67 ext 5', '+1234567890123456'])('rejects %s', (input) => {
    expect(normalizePhone(input).valid).toBe(false);
  });
});

describe('parseLead', () => {
  it('accepts a phone-only lead and normalises it', () => {
    const result = parseLead({ phone: ' 067 123 45 67 ', name: '  Олена ' }, schema);
    expect(result).toEqual({ ok: true, lead: { name: 'Олена', phone: '+380671234567', extra: [] } });
  });

  it('needs a phone or an email', () => {
    const result = parseLead({ name: 'Олена', message: 'Hi' }, schema);
    expect(result).toEqual({ ok: false, fields: { phone: messages.uk.errors.contactRequired } });
  });

  it('reports invalid fields in the configured language', () => {
    const result = parseLead({ phone: 'abc', email: 'not-an-email' }, createLeadSchema(messages.en));
    expect(result).toEqual({
      ok: false,
      fields: { phone: messages.en.errors.invalidPhone, email: messages.en.errors.invalidEmail },
    });
  });

  it('rejects overly long text', () => {
    const result = parseLead({ email: 'a@b.co', message: 'x'.repeat(2001) }, schema);
    expect(result.ok).toBe(false);
  });

  it('keeps extra fields, skips service fields and limits their number', () => {
    const fields: Record<string, string> = { email: 'a@b.co', _form: 'Callback', _t: '1', _gotcha: '', empty: ' ' };
    for (let i = 0; i < 15; i++) fields[`field${i}`] = `value ${i}`;

    const result = parseLead(fields, schema);
    if (!result.ok) throw new Error('expected ok');
    expect(result.lead.form).toBe('Callback');
    expect(result.lead.extra).toHaveLength(10);
    expect(result.lead.extra[0]).toEqual(['field0', 'value 0']);
    expect(result.lead.extra.some(([key]) => key.startsWith('_') || key === 'empty')).toBe(false);
  });
});

describe('checkSpam', () => {
  const options = { now: 100_000, minFillMs: 3000, maxLinks: 2 };

  it('passes a normal submission', () => {
    expect(checkSpam({ phone: '0671234567', _t: '90000' }, options)).toEqual({ spam: false });
  });

  it('catches the honeypot', () => {
    expect(checkSpam({ phone: '0671234567', _gotcha: 'http://spam' }, options)).toEqual({ spam: true, reason: 'honeypot' });
  });

  it('catches forms submitted faster than a human can type', () => {
    expect(checkSpam({ phone: '0671234567', _t: '99500' }, options)).toEqual({ spam: true, reason: 'too_fast' });
  });

  it('skips the timing check when there is no or a nonsense timestamp', () => {
    expect(checkSpam({ phone: '0671234567' }, options).spam).toBe(false);
    expect(checkSpam({ phone: '0671234567', _t: 'abc' }, options).spam).toBe(false);
    expect(checkSpam({ phone: '0671234567', _t: '999999999' }, options).spam).toBe(false);
  });

  it('catches link spam', () => {
    const message = 'cheap http://a.example https://b.example www.c.example';
    expect(checkSpam({ email: 'a@b.co', message }, options)).toEqual({ spam: true, reason: 'too_many_links' });
    expect(checkSpam({ email: 'a@b.co', message: 'see https://my-site.example' }, options).spam).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { TEXTS } from '../src/i18n.ts';
import { createLeadSchema, parseLead } from '../src/lead/lead.ts';

const schema = createLeadSchema(TEXTS.uk);

describe('parseLead', () => {
  it('accepts a phone-only lead and normalises it', () => {
    const result = parseLead({ phone: ' 067 123 45 67 ', name: '  Олена ' }, schema);
    expect(result).toEqual({ ok: true, lead: { name: 'Олена', phone: '+380671234567', extra: [] } });
  });

  it('needs a phone or an email', () => {
    const result = parseLead({ name: 'Олена', message: 'Hi' }, schema);
    expect(result).toEqual({ ok: false, errors: { phone: TEXTS.uk.errors.contactRequired } });
  });

  it('reports invalid fields in the configured language', () => {
    const result = parseLead({ phone: 'abc', email: 'not-an-email' }, createLeadSchema(TEXTS.en));
    expect(result).toEqual({
      ok: false,
      errors: { phone: TEXTS.en.errors.invalidPhone, email: TEXTS.en.errors.invalidEmail },
    });
  });

  it('rejects overly long text', () => {
    const result = parseLead({ email: 'a@b.co', message: 'x'.repeat(2001) }, schema);
    expect(result).toEqual({ ok: false, errors: { message: TEXTS.uk.errors.tooLong } });
  });

  it('reads the form name and source page from service fields', () => {
    const result = parseLead({ email: 'a@b.co', _form: ' Callback ', _page: 'https://cafe.example/' }, schema);
    expect(result).toMatchObject({ ok: true, lead: { formName: 'Callback', page: 'https://cafe.example/' } });
  });

  it('keeps up to ten non-empty extra fields and skips service fields', () => {
    const fields: Record<string, string> = { email: 'a@b.co', _t: '1', _gotcha: '', empty: ' ' };
    for (let i = 0; i < 15; i++) fields[`field${i}`] = `value ${i}`;

    const result = parseLead(fields, schema);
    if (!result.ok) throw new Error('expected a valid lead');
    expect(result.lead.extra).toHaveLength(10);
    expect(result.lead.extra[0]).toEqual(['field0', 'value 0']);
    expect(result.lead.extra.map(([name]) => name)).not.toContain('empty');
  });
});

import { describe, expect, it } from 'vitest';
import { escapeHtml } from '../src/html.ts';
import { TEXTS } from '../src/i18n.ts';
import { humanizeFieldName, renderLeadMessage } from '../src/lead/message.ts';

const context = { texts: TEXTS.uk, locale: 'uk' as const, timeZone: 'Europe/Kyiv', receivedAt: new Date('2026-10-09T11:32:00Z') };

describe('renderLeadMessage', () => {
  it('builds a readable Telegram message', () => {
    const text = renderLeadMessage(
      {
        name: 'Олена',
        phone: '+380671234567',
        message: 'Потрібна кава на 40 гостей',
        extra: [['preferred_time', 'Вечір']],
        formName: 'Кава на захід',
        page: 'https://cafe.example/catering?utm_source=instagram&utm_campaign=autumn',
      },
      context,
    );

    expect(text).toBe(
      [
        '🆕 <b>Нова заявка</b> · Кава на захід',
        '',
        "👤 Ім'я: <b>Олена</b>",
        '📞 Телефон: +380671234567',
        '💬 Повідомлення:',
        '<blockquote>Потрібна кава на 40 гостей</blockquote>',
        '',
        '▫️ Preferred time: Вечір',
        '',
        '🌐 Сторінка: <a href="https://cafe.example/catering?utm_source=instagram&amp;utm_campaign=autumn">cafe.example/catering</a>',
        '📊 UTM: source=instagram · campaign=autumn',
        '🕒 Отримано: 09.10.26, 14:32',
      ].join('\n'),
    );
  });

  it('skips empty sections', () => {
    const text = renderLeadMessage({ email: 'a@b.co', extra: [] }, context);
    expect(text).toBe(['🆕 <b>Нова заявка</b>', '', '✉️ Email: a@b.co', '', '🕒 Отримано: 09.10.26, 14:32'].join('\n'));
  });

  it('escapes HTML everywhere and ignores non-web page links', () => {
    const text = renderLeadMessage(
      { name: '<b>x</b>', email: 'a@b.co', message: '1 < 2 & "q"', extra: [['<k>', '<v>']], page: 'javascript:alert(1)' },
      context,
    );
    expect(text).not.toContain('<b>x</b>');
    expect(text).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(text).toContain('1 &lt; 2 &amp; &quot;q&quot;');
    expect(text).not.toContain('javascript');
  });
});

describe('humanizeFieldName', () => {
  it.each([
    ['preferred_time', 'Preferred time'],
    ['deliveryDate', 'Delivery date'],
    ['кількість-гостей', 'Кількість гостей'],
  ])('%s → %s', (name, expected) => {
    expect(humanizeFieldName(name)).toBe(expected);
  });
});

describe('escapeHtml', () => {
  it('escapes the characters that matter in Telegram HTML', () => {
    expect(escapeHtml(`<&>"'`)).toBe(`&lt;&amp;&gt;&quot;'`);
  });
});

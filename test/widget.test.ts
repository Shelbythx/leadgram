// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { enhance } from '../widget/leadgram.ts';

function renderForm(formAttributes = '') {
  document.documentElement.lang = 'uk';
  document.body.innerHTML = `
    <form data-leadgram="https://forms.example/lead" action="https://forms.example/lead" method="post" ${formAttributes}>
      <label for="name">Ім'я</label><input id="name" name="name" value="Олена">
      <label for="phone">Телефон</label><input id="phone" name="phone" value="067 123 45 67">
      <input type="checkbox" name="extras" value="Кава" checked>
      <input type="checkbox" name="extras" value="Чай" checked>
      <button type="submit">Надіслати</button>
    </form>`;
  const form = document.querySelector('form')!;
  enhance(form);
  return form;
}

const submit = (form: HTMLFormElement) => form.dispatchEvent(new Event('submit', { cancelable: true }));
const statusText = (form: HTMLFormElement) => form.querySelector('[data-leadgram-status]')!.textContent;
const fieldValue = (form: HTMLFormElement, name: string) => (form.elements.namedItem(name) as HTMLInputElement).value;
const jsonReply = (status: number, body: object) => Response.json(body, { status });

function addFileInput(form: HTMLFormElement, files: File[] = []) {
  const input = document.createElement('input');
  input.type = 'file';
  input.name = 'photos';
  Object.defineProperty(input, 'files', { value: files });
  form.append(input);
}

function stubFetch(reply: () => Promise<Response>) {
  const fetch = vi.fn(reply);
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

afterEach(() => vi.unstubAllGlobals());

describe('widget', () => {
  it('adds anti-spam fields and a live status region', () => {
    const form = renderForm();
    expect(fieldValue(form, '_t')).toMatch(/^\d{13}$/);
    expect(fieldValue(form, '_page')).toBe(location.href);
    expect(form.querySelector('[name="_gotcha"]')?.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(form.querySelector('[data-leadgram-status]')?.getAttribute('aria-live')).toBe('polite');
  });

  it('enhances a form only once', () => {
    const form = renderForm();
    enhance(form);
    expect(form.querySelectorAll('[name="_gotcha"]')).toHaveLength(1);
  });

  it('sends JSON, then resets the form and shows success', async () => {
    const fetch = stubFetch(async () => jsonReply(200, { ok: true }));
    const form = renderForm();
    const onSuccess = vi.fn();
    form.addEventListener('leadgram:success', onSuccess);

    submit(form);
    expect(form.dataset.leadgramState).toBe('sending');
    expect(form.querySelector('button')!.disabled).toBe(true);

    await vi.waitFor(() => expect(form.dataset.leadgramState).toBe('success'));
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://forms.example/lead');
    expect(JSON.parse(String(init.body))).toMatchObject({ name: 'Олена', phone: '067 123 45 67', extras: 'Кава, Чай', _gotcha: '' });
    expect(statusText(form)).toContain('Дякуємо');
    expect(form.querySelector('button')!.disabled).toBe(false);
    expect(onSuccess).toHaveBeenCalledOnce();
  });

  it('keeps service fields after the form is reset', async () => {
    stubFetch(async () => jsonReply(200, { ok: true }));
    const form = renderForm();
    submit(form);

    await vi.waitFor(() => expect(form.dataset.leadgramState).toBe('success'));
    expect(fieldValue(form, '_t')).toMatch(/^\d{13}$/);
    expect(fieldValue(form, '_page')).toBe(location.href);
  });

  it('ignores a second submit while the first one is sending', async () => {
    const fetch = stubFetch(() => new Promise<Response>(() => {}));
    const form = renderForm();
    submit(form);
    submit(form);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('marks invalid fields and shows the server message', async () => {
    stubFetch(async () => jsonReply(422, { ok: false, message: 'Перевірте номер телефону', fields: { phone: 'Перевірте номер телефону' } }));
    const form = renderForm();
    submit(form);

    await vi.waitFor(() => expect(form.dataset.leadgramState).toBe('error'));
    const phone = form.elements.namedItem('phone') as HTMLInputElement;
    expect(statusText(form)).toBe('Перевірте номер телефону');
    expect(phone.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(phone);

    phone.dispatchEvent(new Event('input', { bubbles: true }));
    expect(phone.hasAttribute('aria-invalid')).toBe(false);
  });

  it('uses messages from data attributes', async () => {
    stubFetch(async () => jsonReply(200, { ok: true }));
    const form = renderForm('data-success-message="Чекайте дзвінка"');
    submit(form);
    await vi.waitFor(() => expect(statusText(form)).toBe('Чекайте дзвінка'));
  });

  it('sends multipart form data when a file is selected', async () => {
    const fetch = stubFetch(async () => jsonReply(200, { ok: true }));
    const form = renderForm();
    addFileInput(form, [new File(['x'], 'hall.jpg', { type: 'image/jpeg' })]);

    submit(form);
    await vi.waitFor(() => expect(form.dataset.leadgramState).toBe('success'));
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.headers).toEqual({ Accept: 'application/json' });
  });

  it('keeps sending JSON when file inputs are empty', async () => {
    const fetch = stubFetch(async () => jsonReply(200, { ok: true }));
    const form = renderForm();
    addFileInput(form);

    submit(form);
    await vi.waitFor(() => expect(form.dataset.leadgramState).toBe('success'));
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(typeof init.body).toBe('string');
  });

  it('explains network failures', async () => {
    stubFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    const form = renderForm();
    submit(form);
    await vi.waitFor(() => expect(statusText(form)).toContain('Немає зв’язку'));
  });
});

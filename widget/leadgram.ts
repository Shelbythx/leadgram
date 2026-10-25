import { SERVICE_FIELD } from '../src/lead/fields.ts';

export interface EnhanceOptions {
  endpoint?: string;
  successMessage?: string;
  errorMessage?: string;
}

type FormState = 'sending' | 'success' | 'error';

interface StatusTexts {
  sending: string;
  success: string;
  error: string;
  offline: string;
}

interface ServerReply {
  ok?: boolean;
  message?: string;
  fields?: Record<string, string>;
}

interface LeadForm {
  form: HTMLFormElement;
  endpoint: string;
  texts: StatusTexts;
  status: HTMLElement;
}

const DEFAULT_TEXTS: Record<'uk' | 'en', StatusTexts> = {
  uk: {
    sending: 'Надсилаємо…',
    success: 'Дякуємо! Ми зв’яжемося з вами найближчим часом.',
    error: 'Не вдалося надіслати заявку. Спробуйте ще раз.',
    offline: 'Немає зв’язку із сервером. Перевірте інтернет і спробуйте ще раз.',
  },
  en: {
    sending: 'Sending…',
    success: 'Thank you! We will get back to you soon.',
    error: 'Something went wrong. Please try again.',
    offline: 'Could not reach the server. Check your connection and try again.',
  },
};

const FORM_SELECTOR = 'form[data-leadgram]';
const STATUS_ATTRIBUTE = 'data-leadgram-status';
const SUBMIT_BUTTON_SELECTOR = '[type="submit"], button:not([type])';
const FILE_INPUT_SELECTOR = 'input[type="file"]';
const JSON_TYPE = 'application/json';
const OFFSCREEN_STYLE = 'position:absolute!important;left:-10000px!important;width:1px;height:1px;overflow:hidden';

export function enhance(form: HTMLFormElement, options: EnhanceOptions = {}): void {
  if (form.dataset.leadgramReady) return;
  form.dataset.leadgramReady = 'true';

  const leadForm: LeadForm = {
    form,
    endpoint: options.endpoint || form.dataset.leadgram || form.action,
    texts: statusTexts(form, options),
    status: findOrCreateStatus(form),
  };

  addServiceFields(form);
  form.addEventListener('input', (event) => (event.target as Element | null)?.removeAttribute?.('aria-invalid'));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (form.dataset.leadgramState !== 'sending') void submit(leadForm, submitButton(form, event));
  });
}

async function submit(leadForm: LeadForm, button: HTMLButtonElement | HTMLInputElement | null): Promise<void> {
  clearInvalidMarks(leadForm.form);
  setState(leadForm, 'sending', leadForm.texts.sending);
  if (button) button.disabled = true;

  try {
    const { accepted, reply } = await postLead(leadForm.endpoint, leadForm.form);
    if (accepted) showSuccess(leadForm, reply);
    else showRejection(leadForm, reply);
  } catch {
    setState(leadForm, 'error', leadForm.texts.offline);
    emit(leadForm.form, 'error', {});
  } finally {
    if (button) button.disabled = false;
  }
}

async function postLead(endpoint: string, form: HTMLFormElement): Promise<{ accepted: boolean; reply: ServerReply }> {
  const response = await fetch(endpoint, { method: 'POST', ...requestBody(form) });
  const reply = (await response.json().catch(() => ({}))) as ServerReply;
  return { accepted: response.ok && reply.ok === true, reply };
}

function showSuccess(leadForm: LeadForm, reply: ServerReply): void {
  const { form } = leadForm;
  form.reset();
  setHiddenField(form, SERVICE_FIELD.renderedAt, String(Date.now()));
  setState(leadForm, 'success', leadForm.texts.success);
  emit(form, 'success', reply);
  if (form.dataset.redirect) location.assign(form.dataset.redirect);
}

function showRejection(leadForm: LeadForm, reply: ServerReply): void {
  markInvalid(leadForm.form, Object.keys(reply.fields ?? {}));
  setState(leadForm, 'error', reply.message || leadForm.texts.error);
  emit(leadForm.form, 'error', reply);
}

function setState({ form, status }: LeadForm, state: FormState, message: string): void {
  form.dataset.leadgramState = state;
  status.textContent = message;
}

function emit(form: HTMLFormElement, outcome: 'success' | 'error', detail: ServerReply): void {
  form.dispatchEvent(new CustomEvent(`leadgram:${outcome}`, { bubbles: true, detail }));
}

function markInvalid(form: HTMLFormElement, names: string[]): void {
  const fields = names.map((name) => form.elements.namedItem(name)).filter((field) => field instanceof HTMLElement);
  for (const field of fields) field.setAttribute('aria-invalid', 'true');
  fields[0]?.focus();
}

function clearInvalidMarks(form: HTMLFormElement): void {
  form.querySelectorAll('[aria-invalid]').forEach((field) => field.removeAttribute('aria-invalid'));
}

function requestBody(form: HTMLFormElement): RequestInit {
  if (hasSelectedFiles(form)) return { headers: { Accept: JSON_TYPE }, body: new FormData(form) };
  return { headers: { 'Content-Type': JSON_TYPE, Accept: JSON_TYPE }, body: JSON.stringify(collectTextFields(form)) };
}

function hasSelectedFiles(form: HTMLFormElement): boolean {
  return [...form.querySelectorAll<HTMLInputElement>(FILE_INPUT_SELECTOR)].some((input) => (input.files?.length ?? 0) > 0);
}

function collectTextFields(form: HTMLFormElement): Record<string, string> {
  const fields: Record<string, string> = {};
  new FormData(form).forEach((value, name) => {
    if (typeof value === 'string') fields[name] = name in fields ? `${fields[name]}, ${value}` : value;
  });
  return fields;
}

function submitButton(form: HTMLFormElement, event: Event): HTMLButtonElement | HTMLInputElement | null {
  const submitter = (event as SubmitEvent).submitter as HTMLButtonElement | HTMLInputElement | null;
  return submitter ?? form.querySelector<HTMLButtonElement>(SUBMIT_BUTTON_SELECTOR);
}

function statusTexts(form: HTMLFormElement, options: EnhanceOptions): StatusTexts {
  const defaults = DEFAULT_TEXTS[pageLanguage(form)];
  return {
    ...defaults,
    success: options.successMessage || form.dataset.successMessage || defaults.success,
    error: options.errorMessage || form.dataset.errorMessage || defaults.error,
  };
}

function pageLanguage(form: HTMLFormElement): 'uk' | 'en' {
  const lang = form.closest('[lang]')?.getAttribute('lang') || navigator.language || 'en';
  return lang.toLowerCase().startsWith('uk') ? 'uk' : 'en';
}

function findOrCreateStatus(form: HTMLFormElement): HTMLElement {
  let status = form.querySelector<HTMLElement>(`[${STATUS_ATTRIBUTE}]`);
  if (!status) {
    status = document.createElement('p');
    status.setAttribute(STATUS_ATTRIBUTE, '');
    form.append(status);
  }
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  return status;
}

function addServiceFields(form: HTMLFormElement): void {
  setHiddenField(form, SERVICE_FIELD.renderedAt, String(Date.now()));
  setHiddenField(form, SERVICE_FIELD.page, location.href);
  addHoneypot(form);
}

function setHiddenField(form: HTMLFormElement, name: string, value: string): void {
  let input = form.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  if (!input) {
    input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    form.append(input);
  }
  input.value = value;
}

function addHoneypot(form: HTMLFormElement): void {
  if (form.querySelector(`[name="${SERVICE_FIELD.honeypot}"]`)) return;

  const input = document.createElement('input');
  input.type = 'text';
  input.name = SERVICE_FIELD.honeypot;
  input.tabIndex = -1;
  input.autocomplete = 'off';

  const offscreen = document.createElement('div');
  offscreen.setAttribute('aria-hidden', 'true');
  offscreen.style.cssText = OFFSCREEN_STYLE;
  offscreen.append(input);
  form.append(offscreen);
}

function enhanceAllForms(): void {
  document.querySelectorAll<HTMLFormElement>(FORM_SELECTOR).forEach((form) => enhance(form));
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', enhanceAllForms);
  else enhanceAllForms();
}

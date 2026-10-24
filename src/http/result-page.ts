import { escapeHtml } from '../html.ts';
import type { Locale } from '../i18n.ts';

export interface ResultPage {
  tone: 'success' | 'error';
  title: string;
  message: string;
  backLink?: { href: string; label: string } | undefined;
}

const TONE_STYLE = {
  success: { accent: '#1f9d55', mark: '✓' },
  error: { accent: '#d64545', mark: '!' },
} as const;

export function renderResultPage(locale: Locale, page: ResultPage): string {
  const { accent, mark } = TONE_STYLE[page.tone];
  const backLink = page.backLink ? `<a href="${escapeHtml(page.backLink.href)}">${escapeHtml(page.backLink.label)}</a>` : '';

  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(page.title)}</title>
<style>
  :root { color-scheme: light dark; --accent: ${accent}; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; font: 16px/1.5 system-ui, sans-serif; background: Canvas; color: CanvasText; }
  main { max-width: 26rem; padding: 2rem 1.5rem; text-align: center; }
  .mark { width: 3.5rem; height: 3.5rem; margin: 0 auto 1rem; border-radius: 50%; display: grid; place-items: center; font-size: 1.75rem; color: #fff; background: var(--accent); }
  h1 { font-size: 1.5rem; margin: 0 0 .5rem; }
  p { margin: 0 0 1.5rem; opacity: .8; }
  a { color: var(--accent); font-weight: 600; text-decoration: none; }
</style>
</head>
<body>
<main>
  <div class="mark" aria-hidden="true">${mark}</div>
  <h1>${escapeHtml(page.title)}</h1>
  <p>${escapeHtml(page.message)}</p>
  ${backLink}
</main>
</body>
</html>`;
}

# leadgram

[![CI](https://github.com/Shelbythx/leadgram/actions/workflows/ci.yml/badge.svg)](https://github.com/Shelbythx/leadgram/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/node-%3E%3D22.18-339933)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)
![Widget](https://img.shields.io/badge/widget-2%20KB%20gzip-8a63d2)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

**Website forms → Telegram.** A small self-hosted endpoint for landing pages and business sites. Visitors fill in a form, and the owner gets a tidy message in Telegram within a second. Validation, spam protection, rate limiting and a 2 KB drop-in widget are included.

```text
🆕 Нова заявка · Кава на захід

👤 Ім'я: Олена
📞 Телефон: +380671234567
💬 Повідомлення:
┃ Кава на 40 гостей, субота, Буча

▫️ Guests: 20–50
▫️ Extras: Кава-бар, Випічка

🌐 Сторінка: cafe.example/catering
📊 UTM: source=instagram · campaign=autumn
🕒 Отримано: 09.10.26, 14:32
```

## Why

Small businesses answer leads from their phone, not from an inbox. Email notifications get buried, and hosted form services are paid, keep your clients' data on someone else's servers and rarely support Telegram well. leadgram is one small service you deploy once and point any number of forms at.

## Features

- **Works with any site**: plain HTML, Tilda/Webflow custom code, React, Vue. The form keeps working even if JavaScript fails (progressive enhancement)
- **Readable messages**: Ukrainian or English, phone numbers normalized to `+380…` so they are tappable, source page and UTM tags included
- **Spam protection without CAPTCHA**: a hidden honeypot field, a minimum fill time, a link limit, and per-IP rate limiting. Bots get a fake "success" so they learn nothing
- **No lost leads**: if Telegram is down, the visitor sees an error and can retry; double submits are deduplicated
- **Several recipients**: send to the owner, a managers' group, or a specific forum topic
- **Private by default**: lead data is never stored or logged. Logs are JSON lines with events only
- **Small and tested**: Hono + Zod, 86 tests, strict TypeScript, Docker image

## Quick start

**1. Create a bot.** Message [@BotFather](https://t.me/BotFather), send `/newbot`, and copy the token.

**2. Install.**

```bash
git clone https://github.com/Shelbythx/leadgram && cd leadgram
npm install
cp .env.example .env    # then paste the token into TELEGRAM_BOT_TOKEN
```

**3. Find your chat id.** Open your bot in Telegram and press **Start** (or add it to a group and send any message), then run:

```bash
npm run chat-id
```

```text
Chats that recently wrote to @coffee_leads_bot:

  123456789        private     Svyatoslav
  -1001234567890   supergroup  Coffee Point — заявки
```

Put the ids into `TELEGRAM_CHAT_IDS`.

**4. Run it** and open the demo form at http://localhost:3000/demo:

```bash
npm run dev
```

## Add it to your site

```html
<form data-leadgram action="https://forms.example.com/lead" method="post">
  <input type="hidden" name="_form" value="Callback">

  <label for="name">Name</label>
  <input id="name" name="name" autocomplete="name">

  <label for="phone">Phone</label>
  <input id="phone" name="phone" type="tel" autocomplete="tel">

  <button type="submit">Call me back</button>
  <p data-leadgram-status></p>
</form>

<script src="https://forms.example.com/leadgram.js" defer></script>
```

Then add `https://your-site.com` to `ALLOWED_ORIGINS`.

### Fields

| Field | Meaning |
| --- | --- |
| `name`, `message` | Optional text |
| `phone`, `email` | At least one is required; both are validated |
| anything else | Shown in the message as "Field name: value" (up to 10 fields). Checkbox groups are joined: `Coffee, Tea` |
| `_form` | Form name shown in the message title, useful when one site has several forms |
| `_page`, `_t`, `_gotcha` | Added by the widget: source page, render time, honeypot |

### Widget options

| Attribute / event | Effect |
| --- | --- |
| `data-leadgram="url"` | Endpoint to post to (defaults to the form's `action`) |
| `data-success-message`, `data-error-message` | Override the default texts (picked by `<html lang>`: Ukrainian or English) |
| `data-redirect="url"` | Go to a thank-you page after success |
| `[data-leadgram-status]` | Where status text appears (created if missing), `aria-live` for screen readers |
| `form[data-leadgram-state="sending/success/error"]` | Style hook |
| `[aria-invalid="true"]` | Set on fields the server rejected; cleared when the visitor edits them |
| `leadgram:success`, `leadgram:error` | DOM events, e.g. for analytics |
| `Leadgram.enhance(form)` | Enhance a form rendered later (SPAs) |

### React (or any framework) without the widget

```tsx
const renderedAt = useRef(Date.now());

async function submit(data: { name: string; phone: string }) {
  const response = await fetch('https://forms.example.com/lead', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ ...data, _t: String(renderedAt.current), _page: location.href }),
  });
  const result = await response.json(); // { ok: true } or { ok: false, message, fields }
}
```

## API

`POST /lead` accepts `application/json`, `application/x-www-form-urlencoded` or `multipart/form-data` (max 16 KB).

| Status | Body (JSON clients) | When |
| --- | --- | --- |
| `200` | `{ "ok": true }` | Delivered, or silently dropped as spam / duplicate |
| `400` | `{ "ok": false, "error": "bad_request" }` | Unreadable body or unsupported content type |
| `403` | `{ "ok": false, "error": "forbidden_origin" }` | `Origin` not in `ALLOWED_ORIGINS` |
| `413` | `{ "ok": false, "error": "payload_too_large" }` | Body over 16 KB |
| `422` | `{ "ok": false, "error": "validation", "message", "fields" }` | Invalid input; `fields` maps field → message |
| `429` | `{ "ok": false, "error": "rate_limited" }` + `Retry-After` | Too many leads from one IP |
| `502` | `{ "ok": false, "error": "delivery_failed" }` | Telegram did not accept the message |

Requests without `Accept: application/json` (plain HTML forms) get a small localized result page instead, or a redirect to `SUCCESS_REDIRECT`.

Other routes: `GET /health`, `GET /leadgram.js` (the widget), `GET /demo` (when `DEMO_PAGE=true`).

## Configuration

All settings are environment variables; see [`.env.example`](.env.example). Invalid values stop the server at startup with a list of what to fix.

| Variable | Default | Description |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | required | Token from @BotFather |
| `TELEGRAM_CHAT_IDS` | required | Comma-separated chat ids; `-100…:42` posts into forum topic 42 |
| `ALLOWED_ORIGINS` | required | Sites allowed to post, e.g. `https://cafe.com,https://www.cafe.com`; `*` for any |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Where to listen |
| `LOCALE` | `uk` | `uk` or `en`: Telegram messages and visitor-facing errors |
| `TIMEZONE` | `Europe/Kyiv` | Time zone for "Received" |
| `RATE_LIMIT` | `5/10m` | Delivered leads per IP per window (`s`, `m`, `h`) |
| `MIN_FILL_SECONDS` | `3` | Faster submissions are treated as bots |
| `MAX_LINKS` | `2` | More links in text fields is treated as spam |
| `SUCCESS_REDIRECT` | | Thank-you page for no-JS submissions |
| `TRUST_PROXY` | `false` | Read the visitor IP from `X-Forwarded-For` (enable behind a proxy) |
| `TELEGRAM_API_URL` | `https://api.telegram.org` | For a self-hosted Bot API server |
| `DEMO_PAGE` | `false` | Serve `examples/index.html` at `/demo` |

## Deploy

**Docker**

```bash
docker build -t leadgram .
docker run -d --name leadgram --env-file .env -p 3000:3000 --restart unless-stopped leadgram
```

**Render / Railway / Fly.io**: create a web service from the repo with build command `npm ci && npm run build` and start command `node dist/server.js`, add the variables, and set `TRUST_PROXY=true`.

**Behind nginx**: proxy `forms.example.com` to `127.0.0.1:3000` and set `TRUST_PROXY=true`.

## How it works

```text
form ──POST /lead──▶ origin check ─▶ parse body ─▶ spam check ─▶ validate ─▶ dedupe ─▶ rate limit ─▶ Telegram
                       403            400/413      fake 200       422        fake 200     429       502 on failure
```

```text
src/
  app.ts                 routes: /lead, /health, /leadgram.js, /demo
  http/
    lead-route.ts        the pipeline above, step by step
    request.ts           body parsing, JSON detection, client IP
    responder.ts         JSON or HTML responses, error codes → statuses
    origin-policy.ts     allowed origins, trusted referers
    result-page.ts       thank-you / error page for no-JS posts
  lead/
    lead.ts              lead schema and parsing
    phone.ts             phone normalization (+380…)
    message.ts           Telegram HTML message
    fields.ts            service field names shared with the widget
  protection/
    spam-filter.ts       honeypot, fill time, link counting
    rate-limiter.ts      sliding-window limit per IP
    duplicate-guard.ts   double-submit detection (hashes only)
  telegram.ts            Bot API client: retries, flood-control waits, multiple chats
  config.ts              env → typed config with Zod, readable startup errors
  server.ts              Node entry point, graceful shutdown
  chat-id.ts             `npm run chat-id`
widget/
  leadgram.ts            browser widget, bundled by esbuild into dist/widget/leadgram.js
```

Each module does one thing and has its own test file. The app receives everything it talks to (Telegram client, clock, IP lookup, logger) as parameters, so the whole pipeline is tested with `app.request()` and a fake notifier, without a network.

**Scaling note:** rate limits and duplicate detection live in memory, which is right for a single instance. Running several replicas would need a shared store such as Redis.

## Development

```bash
npm run dev         # widget build + server with --watch (Node 22.18+ runs TypeScript directly)
npm test            # vitest: one file per module, HTTP pipeline, widget in happy-dom
npm run typecheck
npm run build       # dist/ + dist/widget/leadgram.js
```

## Roadmap

- Optional Cloudflare Turnstile check for high-traffic sites
- File attachments (photos for repair or design requests)
- Google Sheets / webhook as a second destination

## License

[MIT](LICENSE) © Svyatoslav Maliuga

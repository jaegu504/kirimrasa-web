# Kirimrasa Web – API contract

The web version runs inside the same Node server as the WhatsApp gateway (`server.js`).
It is **off unless `APP_PASSWORD` is set**. The owner's existing Render gateway has no
`APP_PASSWORD`, so it keeps behaving exactly as today for the Android app.

When on:
- `GET /` serves `web/index.html` (static files from `wa-gateway/web/`). `/health` stays the uptime ping.
- Everything under `/app/api/*` needs the session cookie, except `POST /app/api/login`.
- The Android-app routes (`/api/nodes/...`, WebSocket) are unchanged and still use `API_KEY`.

All bodies are JSON unless stated. Errors: `{ "error": "<message>", "code": "<CODE>" }` with a 4xx/5xx status.
Error messages are short English codes; the UI shows its own ID/TR text per `code`.

## Env vars

| Var | Meaning |
|---|---|
| `APP_PASSWORD` | Turns the web UI on; the login password. |
| `API_KEY` | Existing gateway key (Blueprint generates one). Also used as the cookie-signing secret together with APP_PASSWORD. |
| `DATA_DIR` | Where JSON data and uploads live. Default `./data`. (Render free: ephemeral, lost on restart.) |
| `AI_URL` | AI rewrite worker. Default `https://kirimrasa.jaegu108.workers.dev`. |
| `DEFAULT_COUNTRY` | `62` (default) or `90`; prefix for local numbers starting with 0. |

## Auth

- `POST /app/api/login` `{ password }` → `200 { ok: true }` and sets cookie `kr_session` (HttpOnly, SameSite=Lax, Secure when behind https, 30 days, HMAC-signed). Wrong password → `401 { code: "BAD_PASSWORD" }`. More than 5 failed tries per IP per minute → `429 { code: "TOO_MANY_TRIES" }`. Compare in constant time.
- `POST /app/api/logout` → clears cookie.
- `GET /app/api/me` → `{ ok: true, version: "<package version>" }` or `401 { code: "LOGIN_REQUIRED" }`.

## Accounts (WhatsApp)

Two fixed node ids on this server: `personal` and `business`.

- `GET /app/api/accounts` → `[{ id: "personal"|"business", status: "CONNECTED"|"STANDBY"|"CONNECTING"|"PAIRING"|"DISCONNECTED", phone: "62812..."|null }]`
  STANDBY means linked but the socket is idle-closed (treat as linked in the UI).
- `POST /app/api/accounts/:id/pair` `{ phone }` → `{ code: "ABCD1234" }` (8-char pairing code). Already linked → `409 { code: "ALREADY_CONNECTED" }`.
- `POST /app/api/accounts/:id/disconnect` → `{ ok: true }` (logs out and deletes the session).

## Contacts

Stored in `DATA_DIR/contacts.json`. Contact shape:
`{ id, name, phone, nickname, company, custom1, tags: [string], selected: bool }`
`phone` is normalised digits with country code (e.g. `628123456789`). Duplicates are merged by phone; an import never overwrites a nickname or tags the user set.

- `GET /app/api/contacts` → `[Contact]` sorted by name.
- `POST /app/api/contacts/import` (body `text/csv`, ≤ 2 MB) → `{ added, updated, skipped }`.
  Accepts: our own export (`name,phone,nickname,company,custom1,tags` with tags `;`-separated), and Google Contacts CSV (`First Name`/`Last Name` or `Name`, plus `Phone 1 - Value`, `Phone 2 - Value`…; ` ::: ` separates several numbers in one cell, take the first mobile-looking one). Header matching is case-insensitive. New contacts get a nickname guessed from the first word of the name (skip if it looks like a number or title like dr./pak/bu/bapak/ibu/mas/mbak → use the next word).
- `POST /app/api/contacts` `{ name, phone, nickname? }` → `Contact` (manual add).
- `PATCH /app/api/contacts/:id` `{ nickname?, company?, custom1?, tags?, selected? }` → `Contact`.
- `POST /app/api/contacts/select` `{ selected: bool, ids?: [id], tag?: string }` → `{ count }`. No ids and no tag = all contacts.
- `DELETE /app/api/contacts/:id` → `{ ok }`; `DELETE /app/api/contacts` → removes all.
- `GET /app/api/contacts/export` → `text/csv` in our own format.

## Uploads (attachments)

Files in `DATA_DIR/uploads/`.

- `POST /app/api/uploads?name=<file name>` with the raw file as body and its MIME type as `Content-Type`; max 16 MB → `{ id, name, mime, size }`. Too big → `413 { code: "FILE_TOO_LARGE" }`.
- `GET /app/api/uploads/:id` → the file (for previews).
- `DELETE /app/api/uploads/:id` → `{ ok }`.

## AI rewrite

- `POST /app/api/ai/rewrite` `{ message, tone, maxBubbles }` → `{ bubbles: [string] }`.
  `tone` ∈ `friendly | heartfelt | casual | polite | shorter | max_variance`. Server forwards to `AI_URL` (body `{ message, tone, maxBubbles }`), then rejects output that loses a `{Nickname}`/`{Company}`/`{Custom_1}` present in the draft, invents another `{Word}`, or has nested/unbalanced braces → `502 { code: "AI_INVALID" }`. Worker down → `503 { code: "AI_BUSY" }`.

## Settings and draft

`DATA_DIR/settings.json`:

- `GET /app/api/settings` / `PUT /app/api/settings` (partial merge) →
  ```json
  {
    "language": "id",              // "id" | "tr"
    "theme": "system",             // "system" | "light" | "dark"
    "defaultCountry": "62",        // "62" | "90"
    "antiBan": { "preset": "OPTIMAL", "customMinSec": 30, "customMaxSec": 70, "typingSim": true, "pauseMin": 5, "batchSize": 25 },
    "aiTone": "friendly",
    "defaults": { "company": "", "custom1": "" }
  }
  ```
  Presets (seconds between contacts): `CONSERVATIVE` 35–75, `OPTIMAL` 25–65, `TURBO` 15–30, `CUSTOM` customMin–customMax clamped to 10–300 with max ≥ min + 5.
- `GET /app/api/draft` / `PUT /app/api/draft` →
  `{ bubbles: [string] (1–5), attachments: [{ uploadId, name, mime, size, bubbleIndex }], account: "personal"|"business"|"dual" }`
  `bubbleIndex` 0-based; `-1` = send separately after the last bubble. When a campaign starts, the draft is kept as "last sent" so the composer reopens with it.

## Campaign (server-side queue)

Only one campaign at a time. State kept in memory and mirrored to `DATA_DIR/campaign.json` after every change (a restart shows the last state but does not resume sending).

- `POST /app/api/campaign` `{ bubbles, attachments, account, contactIds? }` → `{ id }`.
  `contactIds` omitted = selected contacts, or all contacts when none are selected. Empty text and no attachment → `400 { code: "EMPTY_MESSAGE" }`. No contacts → `400 { code: "NO_CONTACTS" }`. One already running/paused → `409 { code: "CAMPAIGN_RUNNING" }`. No account linked → `400 { code: "NOT_CONNECTED" }`.
- `GET /app/api/campaign` →
  ```json
  {
    "id": "c_...", "title": "Broadcast 26 Okt 14:05",
    "state": "idle|running|paused|cooling|done|stopped",
    "total": 40, "sent": 12, "failed": 1,
    "current": "Budi" ,
    "phase": "waiting|typing|sending|cooldown|null",
    "nextAt": 1761487200000,
    "items": [{ "id", "contactId", "name", "phone", "status": "pending|typing|sent|failed", "error": null, "sentAt": null, "account": "personal" }]
  }
  ```
- `POST /app/api/campaign/pause`, `/resume`, `/stop` → new state. Pause and stop take effect immediately (cancel the running sleep).
- `POST /app/api/campaign/retry-failed` → requeues failed items and resumes.

### Sending rules (mirror the Android `DispatchQueueManager`)

Per contact, in order:
1. Wait a random delay before every contact except the first: average of two uniform draws in the preset range (seconds). Every `batchSize` processed contacts, cool down `pauseMin` minutes (`state: "cooling"`).
2. Render text per contact: spintax `{a|b|c}` picks one option at random; `{Nickname}` → contact nickname, else `Kak` (id) / `efendim` (tr); `{Company}`/`{Custom_1}` → contact value, else `defaults.company`/`defaults.custom1`, else empty.
3. Steps: each bubble is one step; attachments placed on bubble i go with that step (bubble text becomes the caption of the first attachment, further attachments of that bubble follow without caption); attachments with `bubbleIndex` past the last bubble or `-1` are sent alone after the last bubble. Empty bubbles are skipped.
4. If `typingSim`, send "composing" presence before each step and wait 3–6 s between steps of the same contact (also before the first step: 3–6 s typing).
5. Account: `personal`/`business` as chosen; `dual` alternates per contact and falls back to the other account when the chosen one is not linked.
6. Any step failing marks the item `failed` with the error; sending continues with the next contact.
7. Skip contacts with no valid phone (mark failed `INVALID_PHONE`).

## Implementation notes (server as built)

Details the contract above left open, decided in `webapp.js` / `lib/*.js`:

- **Extra error codes**: `INVALID_PHONE` (pair, manual add), `UNKNOWN_ACCOUNT` (404, id not `personal`/`business`), `PAIR_FAILED` (500), `UPLOAD_MISSING` (400, campaign start with an attachment whose upload is gone), `EMPTY_FILE` (400, empty import/upload body), `NO_CAMPAIGN` (404, pause/resume/stop/retry with no campaign), `NOT_FOUND` (404, unknown contact/upload/route), `BAD_JSON` (400), `BODY_TOO_LARGE` (413, JSON bodies are capped at 256 KB), `SERVER_ERROR` (500).
- **Login limit**: after 5 wrong passwords from one IP within a minute, every login from that IP gets 429 (even the right password) until the minute passes.
- **Account status**: `PAIRING` = a socket is open for this id but not registered yet (pairing code requested). `phone` falls back to the number in the saved credentials when the socket is idle.
- **Phones**: `00` international prefix is stripped like `+`; more than 15 digits is rejected too.
- **Import**: `skipped` = rows without a valid phone **plus** rows that matched an existing contact and changed nothing. An existing contact only gets blanks filled (name when it was just the phone, nickname, company, custom1) and new tags added. Also accepted: a `;`-separated file (detected from the header line), Google `Nickname` and `Organization Name` (→ `company`), and some header aliases (`nama`, `telepon`, `mobile`, `whatsapp`, …). Mobile-looking = label contains Mobile/Cell/Ponsel/HP/Cep, or the number starts with `628`/`905`.
- **Manual add** with a phone that already exists merges (fills a blank nickname/name) and returns the existing contact with 200.
- **Export** starts with a UTF-8 BOM so Excel shows non-ASCII names correctly.
- **Uploads** are served with `Content-Security-Policy: sandbox` and `nosniff`; anything not image/video/audio/PDF is sent as `attachment`.
- **Campaign controls** are no-ops (they just return the current state) when they don't apply: pause only while `running`/`cooling`, resume only while `paused`, stop only while active. `retry-failed` on a `done`/`stopped` campaign starts sending again.
- **Bubble pause**: the 3–6 s wait between two steps of one contact happens even with `typingSim` off (as in the Android app); `typingSim` adds the "typing…" presence and the 3–6 s before the first step.
- **Stop mid-contact**: a contact with nothing sent yet goes back to `pending`; one with some steps already sent is marked `failed` with `STOPPED`.
- **Item errors**: `INVALID_PHONE`, `EMPTY_MESSAGE` (text rendered empty and no file), `UPLOAD_MISSING`, `NOT_CONNECTED`, or the WhatsApp error message.
- **Audio attachments** can't carry a caption on WhatsApp, so the bubble text is sent as a text message right before the audio.
- **Anti-ban settings** are read live each round (like the app), so a change applies to the next delay.
- **Campaign title** uses the settings language (`26 Okt` / `26 Eki`) and the time zone from `TZ`, else Asia/Jakarta (62) or Europe/Istanbul (90).
- **AI request** to the worker also carries `prompt` (= message) and `language` (`ID`/`TR`), like the app.

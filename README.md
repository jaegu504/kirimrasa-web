# Kirimrasa Web

Send one warm, personal WhatsApp message to many of your own contacts — from your own free server.
Kirim satu pesan WhatsApp yang terasa personal ke banyak kontakmu sendiri — dari server gratis milikmu sendiri.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/jaegu504/kirimrasa-web)

- **Panduan pemasangan (Indonesia) / Kurulum rehberi (Türkçe):** [docs/PANDUAN.md](docs/PANDUAN.md)

## What you get

- Messages of 1–5 chat bubbles with `{Nickname}`, `{Company}`, `{Custom_1}` and `{a|b}` word variation
- AI rewrite in six styles (friendly, heartfelt, casual, polite, shorter, more variation) that keeps your language and greetings
- Photos, videos and documents placed on a chosen bubble (max 16 MB each)
- Contacts from CSV (including a Google Contacts export) or vCard (.vcf), nicknames and labels
- A sending queue that runs on the server: random delays, typing simulation, automatic breaks, pause/stop, retry failed
- Indonesian and Turkish, light and dark, works on phone and laptop

Your WhatsApp session, contacts and messages stay on your own server. Sending uses your own WhatsApp account, linked with an 8-digit pairing code — no paid WhatsApp API.

## Good to know

- Render's free plan sleeps after 15 minutes idle; keep it awake with a free UptimeRobot monitor on `/health` (see the guide).
- Render's free plan has no permanent disk: after a restart you link WhatsApp again, and contacts/settings may be reset. Export your contacts as CSV now and then.
- Send only to people you know. Keep the default delays; they protect your number.

## Run locally

```bash
npm install
APP_PASSWORD=choose-a-password API_KEY=any-long-random-string node server.js
```

Open http://localhost:3000. Tests: `npm test`. API: [WEB_API.md](WEB_API.md).

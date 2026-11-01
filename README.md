# FakeseBacho — Job Scam Shield

AI-powered Chrome extension that detects fake job and internship listings on Internshala, LinkedIn, Naukri, Indeed, Unstop and more.

---

## What it does

Opens any job listing → analyses it with Claude AI → gives you a 0–100 risk score with specific red flags, company verdict, and what to do next.

Catches: registration fees, Aadhaar fraud, WhatsApp-only recruiters, guaranteed income scams, fake companies, unrealistic salaries, no-interview instant offers.

---

## Install

1. Download the latest ZIP from [Releases](../../releases)
2. Unzip to a permanent folder
3. Open Chrome → `chrome://extensions` → enable **Developer mode**
4. Click **Load unpacked** → select the unzipped folder
5. Click the FB icon → Settings → paste your Anthropic API key

Full walkthrough → [Install Guide](https://claude.ai/artifact/FUigNnMcTTX8engeRtUCVy)

---

## Supported platforms

| Platform | Status |
|---|---|
| Internshala | ✅ Full |
| LinkedIn Jobs | ✅ Full |
| Naukri | ✅ Full |
| Indeed India | ✅ Full |
| Unstop | ✅ Full |
| Shine | ⚡ Partial |

---

## You need

- Chrome (or any Chromium browser)
- An Anthropic API key → [get one free](https://console.anthropic.com/keys)

The API key stays in your browser. It is never sent to our servers.

---

## Project structure

```
faksebacho-extension/
├── manifest.json        Chrome MV3 config
├── background.js        Service worker — AI calls, cache, reports
├── content.js           DOM extractor + floating badge (6 platforms)
├── content.css          Badge styles
├── popup.html/js/css    Extension popup UI
├── config.js            Public config — edit this for your deployment
├── dev.vars.example     Secret template — copy to dev.vars, never commit
├── worker/
│   ├── index.js         Cloudflare Worker proxy
│   └── wrangler.toml    Worker deploy config
└── icons/
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

You do not need any secrets file to contribute. Clone, load unpacked, add your own Anthropic key, start working.

---

## Secrets model

| Secret | Where | Committed |
|---|---|---|
| Your Anthropic API key | Your browser only | Never |
| `SUPABASE_ANON_KEY` | `config.js` | ✅ Yes (safe — RLS enforced) |
| `SUPABASE_SERVICE_ROLE_KEY` | `dev.vars` only | ❌ No |
| `CF_API_TOKEN` | `dev.vars` only | ❌ No |
| `WORKER_AUTH_SECRET` | `config.js` + Wrangler secret | ✅ Config yes, value via `wrangler secret put` |

---

## Report a scam listing

Found a fake job that slipped through? Open the extension → Report button → select reasons. Reports are stored locally and synced to the community database.

---

## License

MIT

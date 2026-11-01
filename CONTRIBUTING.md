# Contributing to FakeseBacho

Thanks for contributing. This doc explains the project structure, what secrets exist, and how to set up a local dev environment.

---

## What you need vs. what you don't

| Thing | Who has it | You need it to contribute? |
|---|---|---|
| Anthropic API key | **You (the user)** — entered in the popup | Only if you want to test AI analysis locally |
| `SUPABASE_URL` + `SUPABASE_ANON_KEY` | In `config.js` (public) | Already there — no setup needed |
| `SUPABASE_SERVICE_ROLE_KEY` | Maintainer only (`dev.vars`) | **No** — you never need this |
| `WORKER_AUTH_SECRET` | In `config.js` (disclosed, intentional) | Already there |
| `CF_API_TOKEN` | Maintainer only (`dev.vars`) | **No** — only needed to deploy the Worker |
| `WORKER_URL` | In `config.js` (public) | Already there |

**Short version:** Clone the repo, load the extension unpacked, add your own Anthropic key in the popup, and you're done. You don't need any secrets file.

---

## Project structure

```
faksebacho-extension/
├── config.js          ← Public config (committed). Edit this to change endpoints/flags.
├── background.js      ← Service worker. Imports config.js.
├── content.js         ← DOM extractor + floating badge.
├── content.css        ← Badge styles.
├── popup.html/js/css  ← Extension popup UI.
├── manifest.json      ← MV3 manifest.
├── .gitignore         ← Blocks dev.vars and secrets.
│
├── worker/
│   ├── index.js       ← Cloudflare Worker source.
│   └── wrangler.toml  ← Worker config (no secrets).
│
└── dev.vars           ← !! NOT COMMITTED — maintainer only !!
                          Contains: SUPABASE_SERVICE_ROLE_KEY,
                          CF_API_TOKEN, CF_ACCOUNT_ID, WORKER_AUTH_SECRET (raw)
```

---

## Local dev setup

```bash
# 1. Clone
git clone https://github.com/YOUR_ORG/faksebacho-extension
cd faksebacho-extension

# 2. Load in Chrome
# chrome://extensions → Developer mode ON → Load unpacked → select this folder

# 3. Add your Anthropic key
# Click the FD extension icon → Settings → paste your sk-ant-... key

# 4. Open any Internshala internship listing and test
```

That's it. No `npm install`, no build step. The extension is plain JS.

---

## Testing the Worker locally (optional)

Only needed if you're working on `worker/index.js`.

```bash
# You need wrangler installed
npm install -g wrangler
wrangler login

# Create a dev.vars file (copy from dev.vars.example, fill in your values)
cp dev.vars.example dev.vars
# Edit dev.vars — get WORKER_AUTH_SECRET from a maintainer or generate your own for local testing

cd worker
wrangler dev --env development
# Worker runs at http://localhost:8787

# In config.js, temporarily set:
# WORKER_URL: "http://localhost:8787"
# FEATURES.WORKER_PROXY: true
```

---

## What `dev.vars` contains (for maintainers)

Contributors don't need this file. It exists only for:
- Deploying the Cloudflare Worker (`CF_API_TOKEN`, `CF_ACCOUNT_ID`)
- Running DB migration scripts (`SUPABASE_SERVICE_ROLE_KEY`)
- Local Worker dev that needs real secrets

If you're a maintainer setting up from scratch, copy `dev.vars.example` and fill it in. Then run:

```bash
# Set Worker secrets (these go into Cloudflare, not wrangler.toml)
wrangler secret put WORKER_AUTH_SECRET
wrangler secret put ANTHROPIC_API_KEY   # your developer key (fallback)

# Create KV namespace for rate limiting
wrangler kv:namespace create "RATE_LIMIT_KV"
# Copy the output ID into worker/wrangler.toml → kv_namespaces[].id
```

---

## The API key split — why it's designed this way

- **User's Anthropic key** → stored in `chrome.storage.local`, sent only to `api.anthropic.com` (direct mode) or forwarded through the Worker (proxy mode). It is **never** stored on any server.
- **Developer's Anthropic key** → set as a Wrangler secret (`ANTHROPIC_API_KEY`). Used as a fallback in the Worker. Contributors don't need it.
- **Supabase anon key** → in `config.js`, safe to expose because Row Level Security policies limit what it can do (read reports, write reports, read/write cache — no access to anything else).
- **Supabase service role key** → in `dev.vars` only. Has full DB access. Never shipped in the extension or the Worker.

---

## Making a PR

1. Keep changes to one concern per PR
2. Don't add new fields to `dev.vars` without adding them to `dev.vars.example` too
3. Don't hardcode URLs, keys, or model names — use `config.js`
4. Feature flags go in `CONFIG.FEATURES` so things can be toggled without a new release

---

## dev.vars.example (commit this — it's the template with no real values)

```ini
SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...YOUR_SERVICE_ROLE_KEY
SUPABASE_DB_PASSWORD=
CF_ACCOUNT_ID=
CF_API_TOKEN=
WORKER_AUTH_SECRET=generate_with__node_-e_"console.log(require('crypto').randomBytes(32).toString('hex'))"
SENTRY_DSN=
NODE_ENV=development
WORKER_URL=http://localhost:8787
```

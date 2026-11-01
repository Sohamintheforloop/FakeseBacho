// ─────────────────────────────────────────────────────────────────
//  FakeseBacho — Extension Config
//  This file IS committed and IS shipped inside the extension.
//
//  What belongs here:
//    ✓  Supabase ANON key  — safe to expose (Row Level Security
//       policies enforce read/write rules; service role key is NOT here)
//    ✓  Worker URL         — public endpoint, that's the point
//    ✓  Worker auth secret — signs requests so only this extension
//                            can hit your Worker (not a secret per se;
//                            it's more of an API token for YOUR app)
//    ✓  Feature flags      — control rollout without a deploy
//
//  What does NOT belong here:
//    ✗  ANTHROPIC_API_KEY  — users supply their own in the popup
//    ✗  SUPABASE_SERVICE_ROLE_KEY — stays in dev.vars / Wrangler secrets
//    ✗  CF_API_TOKEN       — stays in dev.vars
// ─────────────────────────────────────────────────────────────────

const CONFIG = {

  // ── Anthropic / LLM ─────────────────────────────────────────────
  // The model the extension uses. Users bring their own API key —
  // this just pins which model their key calls.
  ANTHROPIC_MODEL: "claude-sonnet-4-6",
  ANTHROPIC_API_URL: "https://api.anthropic.com/v1/messages",
  // NOTE: When WORKER_PROXY_ENABLED = true, calls go to WORKER_URL
  // instead and the user's key is forwarded in the request body.
  // When false, the extension calls Anthropic directly with the user's key.

  // ── Cloudflare Worker (your proxy) ───────────────────────────────
  WORKER_URL: "https://faksebacho.YOUR_SUBDOMAIN.workers.dev",
  // Auth token — signs requests from this extension to your Worker.
  // The Worker validates this so random scrapers can't use your endpoint.
  // This is intentionally disclosed in the extension (it's per-app, not per-user).
  WORKER_AUTH_SECRET: "REPLACE_WITH_YOUR_WORKER_AUTH_SECRET",

  // ── Supabase (community DB) ───────────────────────────────────────
  // Anon key is safe to expose — RLS policies control what it can do:
  //   • reports:  anyone can INSERT and SELECT
  //   • analysis_cache: anyone can SELECT; INSERT/UPDATE allowed
  //   • No DELETE, no access to other tables
  SUPABASE_URL: "https://YOUR_PROJECT_ID.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.REPLACE_WITH_ANON_KEY",

  // ── Feature Flags ─────────────────────────────────────────────────
  // Toggle features without shipping a new extension version.
  FEATURES: {
    SHARED_CACHE:       true,   // Check Supabase cache before calling Claude
    COMMUNITY_REPORTS:  true,   // Submit/read reports from Supabase
    WORKER_PROXY:       false,  // Route Claude calls through your Worker
                                // (set true once Worker is deployed)
    FALLBACK_LOCAL:     true,   // Fall back to rule-based analysis if API fails
    ANALYSIS_HISTORY:   true,   // Store history in chrome.storage.local
  },

  // ── Cache TTLs ────────────────────────────────────────────────────
  LOCAL_CACHE_TTL_MS:  24 * 60 * 60 * 1000,   // 24 hours — local
  SHARED_CACHE_TTL_HR: 24,                      // 24 hours — Supabase

  // ── Rate limiting (client-side guard) ────────────────────────────
  MAX_SCANS_PER_HOUR: 30,   // soft limit per user session
};

// Freeze so nothing in the extension accidentally mutates config
Object.freeze(CONFIG);
Object.freeze(CONFIG.FEATURES);

export default CONFIG;

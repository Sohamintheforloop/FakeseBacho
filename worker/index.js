// FakeseBacho — Cloudflare Worker
// Proxies Anthropic API calls from the extension.
//
// Secrets set via `wrangler secret put` (NOT in wrangler.toml or code):
//   WORKER_AUTH_SECRET  — must match config.js WORKER_AUTH_SECRET
//   ANTHROPIC_API_KEY   — your developer key (optional: used when user has no key)
//
// KV namespace bound in wrangler.toml:
//   RATE_LIMIT_KV  — tracks per-user request counts
//
// The user's own API key is forwarded to Anthropic if provided.
// If not (future: key-free mode), falls back to env.ANTHROPIC_API_KEY.

export default {
  async fetch(request, env) {
    // ── CORS preflight ──────────────────────────────────────────
    if (request.method === "OPTIONS") {
      return corsResponse(null, 204);
    }

    if (request.method !== "POST") {
      return corsResponse({ error: "Method not allowed" }, 405);
    }

    const url = new URL(request.url);

    // ── Route: /analyze ─────────────────────────────────────────
    if (url.pathname === "/analyze") {
      return handleAnalyze(request, env);
    }

    // ── Route: /report ──────────────────────────────────────────
    if (url.pathname === "/report") {
      return handleReport(request, env);
    }

    return corsResponse({ error: "Not found" }, 404);
  },
};

// ── /analyze handler ──────────────────────────────────────────────────────────

async function handleAnalyze(request, env) {
  // 1. Validate the request is from OUR extension (HMAC signature)
  const sig = request.headers.get("X-FakeseBacho-Sig");
  const userKeyHash = request.headers.get("X-User-Key-Hash") || "anonymous";

  let body;
  try {
    body = await request.json();
  } catch {
    return corsResponse({ error: "Invalid JSON body" }, 400);
  }

  const { prompt, userApiKey, model } = body;

  if (!prompt) return corsResponse({ error: "Missing prompt" }, 400);

  // Verify HMAC signature
  const validSig = await verifyHmac(prompt, sig, env.WORKER_AUTH_SECRET);
  if (!validSig) {
    return corsResponse({ error: "Unauthorized — invalid request signature" }, 401);
  }

  // 2. Rate limiting — 30 requests/hour per user key hash
  const rateLimitKey = `rate:${userKeyHash}`;
  const allowed = await checkRateLimit(env.RATE_LIMIT_KV, rateLimitKey, 30, 3600);
  if (!allowed) {
    return corsResponse({ error: "RATE_LIMITED", message: "Too many requests. Try again in an hour." }, 429);
  }

  // 3. Decide which API key to use
  // Priority: user's own key > developer key (env.ANTHROPIC_API_KEY)
  const apiKey = userApiKey || env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return corsResponse({ error: "NO_API_KEY", message: "No API key available." }, 400);
  }

  // 4. Forward to Anthropic
  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: model || "claude-sonnet-4-6",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!upstream.ok) {
      const err = await upstream.json().catch(() => ({}));
      // Don't expose Anthropic error details verbatim
      const code = upstream.status === 401 ? "INVALID_API_KEY"
                  : upstream.status === 429 ? "RATE_LIMITED"
                  : "UPSTREAM_ERROR";
      return corsResponse({ error: code }, upstream.status);
    }

    const data = await upstream.json();
    const text = data.content?.[0]?.text || "";

    // Return only the text — don't forward Anthropic metadata
    return corsResponse({ text }, 200);

  } catch (err) {
    return corsResponse({ error: "WORKER_ERROR", message: "Upstream request failed." }, 502);
  }
}

// ── /report handler ───────────────────────────────────────────────────────────

async function handleReport(request, env) {
  // Reports are handled by Supabase directly from the extension.
  // This endpoint exists for future server-side validation / deduplication.
  return corsResponse({ ok: true, message: "Use Supabase direct for reports." }, 200);
}

// ── Rate Limiter (Cloudflare KV) ──────────────────────────────────────────────

async function checkRateLimit(kv, key, limit, windowSecs) {
  if (!kv) return true; // KV not bound — skip rate limiting in local dev

  try {
    const raw = await kv.get(key, "json");
    const now = Math.floor(Date.now() / 1000);

    if (!raw || now > raw.resetAt) {
      // First request or window expired — reset counter
      await kv.put(key, JSON.stringify({ count: 1, resetAt: now + windowSecs }), { expirationTtl: windowSecs });
      return true;
    }

    if (raw.count >= limit) return false;

    await kv.put(key, JSON.stringify({ count: raw.count + 1, resetAt: raw.resetAt }), { expirationTtl: windowSecs });
    return true;
  } catch {
    return true; // KV error — fail open
  }
}

// ── HMAC Verification ─────────────────────────────────────────────────────────

async function verifyHmac(body, signature, secret) {
  if (!signature || !secret) return false;
  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw", enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false, ["verify"]
    );
    const sigBytes = new Uint8Array(signature.match(/../g).map(h => parseInt(h, 16)));
    return await crypto.subtle.verify("HMAC", key, sigBytes, enc.encode(body));
  } catch {
    return false;
  }
}

// ── CORS Response Helper ──────────────────────────────────────────────────────

function corsResponse(body, status = 200) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "chrome-extension://*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-FakeseBacho-Sig, X-User-Key-Hash",
  };
  return new Response(body !== null ? JSON.stringify(body) : null, { status, headers });
}

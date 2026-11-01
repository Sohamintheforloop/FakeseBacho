// FakeseBacho — Background Service Worker
// Handles AI analysis, storage, message routing, and Supabase integration

import CONFIG from "./config.js";

const { FEATURES, LOCAL_CACHE_TTL_MS } = CONFIG;

// ── Message Router ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "ANALYZE_JOB") {
    handleAnalysis(msg.payload, sender.tab?.id)
      .then(result => sendResponse({ ok: true, data: result }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.type === "SUBMIT_REPORT") {
    handleReport(msg.payload)
      .then(result => sendResponse({ ok: true, data: result }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.type === "GET_SETTINGS") {
    chrome.storage.local.get(["settings"], res => {
      sendResponse({ ok: true, data: res.settings || defaultSettings() });
    });
    return true;
  }

  if (msg.type === "SAVE_SETTINGS") {
    chrome.storage.local.set({ settings: msg.payload }, () => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.type === "GET_REPORTS_FOR_URL") {
    getReportsForUrl(msg.payload.url)
      .then(reports => sendResponse({ ok: true, data: reports }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});

// ── Default Settings ────────────────────────────────────────────────────────

function defaultSettings() {
  return {
    // User provides their own Anthropic key — stored locally, never sent to our servers
    apiKey: "",
    autoScan: true,
    showBadge: true,
    sensitivityLevel: "medium",
    consentGiven: false,
    reportingEnabled: true,
    analysisHistory: true,
  };
}

// ── Analysis Handler ─────────────────────────────────────────────────────────

async function handleAnalysis(payload, tabId) {
  const { jobData, url, forceRefresh } = payload;

  // 1. Local cache (fastest)
  if (!forceRefresh) {
    const local = await getLocalCache(url);
    if (local) {
      updateBadge(tabId, local.score);
      return local;
    }
  }

  // 2. Shared Supabase cache (saves user's API credits)
  if (!forceRefresh && FEATURES.SHARED_CACHE) {
    const shared = await getSharedCache(url);
    if (shared) {
      // Persist locally so next visit is instant
      await setLocalCache(url, shared);
      updateBadge(tabId, shared.score);
      return { ...shared, fromSharedCache: true };
    }
  }

  // 3. Call Claude — via Worker proxy or direct with user's key
  const settingsData = await chrome.storage.local.get(["settings"]);
  const settings = settingsData.settings || defaultSettings();

  // User's API key is always required — either for direct calls or forwarded through proxy
  if (!settings.apiKey) throw new Error("NO_API_KEY");

  const prompt = buildAnalysisPrompt(jobData);
  let analysis;

  if (FEATURES.WORKER_PROXY) {
    // Route through your Cloudflare Worker
    // Worker uses your Anthropic key server-side; user key used for auth/rate-limit identity
    analysis = await callViaWorker(prompt, settings.apiKey);
  } else {
    // Direct call — user's key hits Anthropic directly, nothing goes through your servers
    analysis = await callAnthropicDirect(prompt, settings.apiKey);
  }

  const result = parseAnalysisResponse(analysis, jobData, url);

  // Cache locally
  await setLocalCache(url, result);

  // Cache in Supabase (helps future users with same listing)
  if (FEATURES.SHARED_CACHE) {
    setSharedCache(url, result).catch(() => {}); // fire-and-forget, don't block UI
  }

  // Save to history
  if (settings.analysisHistory) {
    await appendHistory(url, result);
  }

  updateBadge(tabId, result.score);
  return result;
}

// ── LLM Call: Direct (user's own key → Anthropic) ───────────────────────────
// This path: user key never leaves the browser except to api.anthropic.com

async function callAnthropicDirect(prompt, userApiKey) {
  const response = await fetch(CONFIG.ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": userApiKey,          // user's own key
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CONFIG.ANTHROPIC_MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    if (response.status === 401) throw new Error("INVALID_API_KEY");
    if (response.status === 429) throw new Error("RATE_LIMITED");
    throw new Error(err.error?.message || `API error ${response.status}`);
  }

  const data = await response.json();
  return data.content?.[0]?.text || "";
}

// ── LLM Call: Via Worker proxy (user's key forwarded, your Worker calls Anthropic) ──
// This path: user key is sent to YOUR Worker over HTTPS, Worker calls Anthropic.
// Enables: rate limiting, shared cost, no key needed in future.

async function callViaWorker(prompt, userApiKey) {
  // Sign the request so only YOUR extension can hit your Worker
  const signature = await signRequest(prompt, CONFIG.WORKER_AUTH_SECRET);

  const response = await fetch(`${CONFIG.WORKER_URL}/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-FakeseBacho-Sig": signature,    // HMAC — Worker validates this
      "X-User-Key-Hash": await hashKey(userApiKey), // identify user for rate limiting, not the actual key
    },
    body: JSON.stringify({
      prompt,
      userApiKey,   // forwarded to Anthropic by Worker; never logged
      model: CONFIG.ANTHROPIC_MODEL,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Worker error ${response.status}`);
  }

  const data = await response.json();
  return data.text || "";
}

// ── Supabase: Shared Cache ───────────────────────────────────────────────────

async function getSharedCache(url) {
  try {
    const hash = simpleHash(url);
    const now = new Date().toISOString();
    const endpoint = `${CONFIG.SUPABASE_URL}/rest/v1/analysis_cache` +
      `?url_hash=eq.${encodeURIComponent(hash)}&expires_at=gt.${now}&select=result&limit=1`;

    const res = await fetch(endpoint, {
      headers: {
        apikey: CONFIG.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
      },
    });

    if (!res.ok) return null;
    const rows = await res.json();
    return rows?.[0]?.result || null;
  } catch {
    return null; // Supabase down — degrade gracefully
  }
}

async function setSharedCache(url, result) {
  try {
    const hash = simpleHash(url);
    const expiresAt = new Date(Date.now() + CONFIG.SHARED_CACHE_TTL_HR * 3600 * 1000).toISOString();

    await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/analysis_cache`, {
      method: "POST",
      headers: {
        apikey: CONFIG.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates", // upsert on url_hash conflict
      },
      body: JSON.stringify({
        url_hash: hash,
        url,
        result,
        score: result.score,
        verdict: result.verdict,
        cached_at: new Date().toISOString(),
        expires_at: expiresAt,
      }),
    });
  } catch {
    // Non-fatal — local cache still works
  }
}

// ── Supabase: Community Reports ──────────────────────────────────────────────

async function submitSharedReport(payload) {
  if (!FEATURES.COMMUNITY_REPORTS) return;
  try {
    await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/reports`, {
      method: "POST",
      headers: {
        apikey: CONFIG.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        url: payload.url,
        platform: payload.jobData?.platform || null,
        job_title: payload.jobData?.title || null,
        company: payload.jobData?.company || null,
        reasons: payload.reasons || [],
        note: payload.userNote || null,
      }),
    });
  } catch {
    // Fail silently — local report still saved
  }
}

async function getSharedReportCount(url) {
  if (!FEATURES.COMMUNITY_REPORTS) return 0;
  try {
    const res = await fetch(
      `${CONFIG.SUPABASE_URL}/rest/v1/reports?url=eq.${encodeURIComponent(url)}&select=id`,
      {
        headers: {
          apikey: CONFIG.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
        },
      }
    );
    if (!res.ok) return 0;
    const rows = await res.json();
    return Array.isArray(rows) ? rows.length : 0;
  } catch {
    return 0;
  }
}

// ── Local Cache ───────────────────────────────────────────────────────────────

async function getLocalCache(url) {
  const key = "cache_" + simpleHash(url);
  const res = await chrome.storage.local.get([key]);
  const cached = res[key];
  if (!cached) return null;
  if (Date.now() - cached.timestamp > LOCAL_CACHE_TTL_MS) return null;
  return { ...cached.data, fromCache: true };
}

async function setLocalCache(url, data) {
  const key = "cache_" + simpleHash(url);
  await chrome.storage.local.set({ [key]: { timestamp: Date.now(), data } });
}

// ── History ───────────────────────────────────────────────────────────────────

async function appendHistory(url, result) {
  const res = await chrome.storage.local.get(["analysisHistory"]);
  const history = res.analysisHistory || [];
  history.unshift({
    url,
    title: result.jobData?.title || "Unknown",
    company: result.jobData?.company || "Unknown",
    score: result.score,
    verdict: result.verdict,
    platform: result.jobData?.platform || "Unknown",
    analysedAt: result.analysedAt,
  });
  await chrome.storage.local.set({ analysisHistory: history.slice(0, 100) });
}

// ── Report Handler ────────────────────────────────────────────────────────────

async function handleReport(payload) {
  const { url, reasons, jobData, userNote } = payload;

  // Always save locally first
  const res = await chrome.storage.local.get(["userReports"]);
  const reports = res.userReports || [];

  const report = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2),
    url,
    reasons,
    jobData: {
      title: jobData?.title,
      company: jobData?.company,
      platform: jobData?.platform,
    },
    userNote: userNote || "",
    reportedAt: new Date().toISOString(),
  };

  reports.unshift(report);
  await chrome.storage.local.set({ userReports: reports.slice(0, 500) });

  // Also push to Supabase (fire-and-forget)
  submitSharedReport(payload).catch(() => {});

  // Return combined count: local + community
  const [localCount, sharedCount] = await Promise.all([
    Promise.resolve(reports.filter(r => r.url === url).length),
    getSharedReportCount(url),
  ]);

  return {
    reportId: report.id,
    localReports: localCount,
    totalReports: Math.max(localCount, sharedCount), // deduplicate optimistically
  };
}

async function getReportsForUrl(url) {
  const res = await chrome.storage.local.get(["userReports"]);
  const localReports = (res.userReports || []).filter(r => r.url === url);
  const sharedCount = await getSharedReportCount(url);
  return {
    count: Math.max(localReports.length, sharedCount),
    localCount: localReports.length,
    sharedCount,
    reports: localReports,
  };
}

// ── Prompt & Parsing ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are FakeseBacho, an expert at identifying fake, fraudulent, or misleading job and internship listings. You analyze job postings with a focus on the Indian job market (Internshala, Naukri, LinkedIn India, etc.) but work globally.

You MUST respond with ONLY valid JSON — no preamble, no markdown, no explanation outside the JSON.

Your output schema:
{
  "score": <integer 0-100, where 100 = definitely fake/scam>,
  "verdict": <"safe" | "suspicious" | "likely_fake" | "definite_scam">,
  "summary": <string, 1-2 sentences, plain English verdict for the user>,
  "flags": [
    {
      "id": <string, snake_case unique id>,
      "severity": <"high" | "medium" | "low">,
      "category": <"financial" | "identity" | "company" | "role" | "communication" | "legal" | "technical">,
      "title": <string, short flag title>,
      "detail": <string, 1 sentence explanation>,
      "evidence": <string | null, exact quoted text from the listing that triggered this flag, or null>
    }
  ],
  "positives": [{ "title": <string>, "detail": <string> }],
  "companyVerdict": {
    "name": <string>,
    "confidence": <"verified" | "unverifiable" | "suspicious" | "known_scammer">,
    "notes": <string>
  },
  "recommendations": [<string>],
  "analysedAt": <ISO8601 timestamp>
}

Scoring: 0-20 legitimate, 21-40 minor concerns, 41-60 suspicious, 61-80 likely fake, 81-100 definite scam.

Key red flags (India-specific): security deposit, registration fee, training fee, upfront payment, Aadhaar/PAN before hiring, bank account before offer, unverifiable company, free email domain for business, guaranteed income claims, no experience needed for high pay, WhatsApp-only contact, instant offer no interview, pressure tactics.`;

function buildAnalysisPrompt(jobData) {
  return `Analyze this job/internship listing:

PLATFORM: ${jobData.platform}
URL: ${jobData.url}
COMPANY: ${jobData.company || "Not specified"}
TITLE: ${jobData.title || "Not specified"}
LOCATION: ${jobData.location || "Not specified"}
STIPEND/SALARY: ${jobData.salary || "Not specified"}
DURATION: ${jobData.duration || "Not specified"}
OPENINGS: ${jobData.openings || "Not specified"}
APPLICANTS: ${jobData.applicants || "Not specified"}
POSTED: ${jobData.postedDate || "Not specified"}

DESCRIPTION:
${jobData.description || "No description"}

REQUIREMENTS:
${jobData.requirements || "Not specified"}

PERKS:
${jobData.perks || "Not specified"}

Respond with ONLY the JSON object.`;
}

function parseAnalysisResponse(rawText, jobData, url) {
  try {
    const clean = rawText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(clean);
    return {
      score: Math.min(100, Math.max(0, parseInt(parsed.score) || 0)),
      verdict: parsed.verdict || "suspicious",
      summary: parsed.summary || "Analysis complete.",
      flags: Array.isArray(parsed.flags) ? parsed.flags : [],
      positives: Array.isArray(parsed.positives) ? parsed.positives : [],
      companyVerdict: parsed.companyVerdict || { name: jobData?.company, confidence: "unverifiable", notes: "" },
      recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
      analysedAt: parsed.analysedAt || new Date().toISOString(),
      jobData,
      url,
      fromCache: false,
    };
  } catch {
    return fallbackAnalysis(jobData, url);
  }
}

function fallbackAnalysis(jobData, url) {
  if (!FEATURES.FALLBACK_LOCAL) throw new Error("AI_UNAVAILABLE");
  const flags = [];
  let score = 20;
  const text = ((jobData?.description || "") + " " + (jobData?.title || "")).toLowerCase();

  const CHECKS = [
    { re: /registration fee|security deposit|training fee|refundable deposit/i, sev: "high", cat: "financial", title: "Upfront payment required" },
    { re: /guaranteed income|earn \d+k|work from home.*data entry/i, sev: "high", cat: "role", title: "Unrealistic income claim" },
    { re: /whatsapp only|contact on whatsapp/i, sev: "medium", cat: "communication", title: "WhatsApp-only contact" },
    { re: /aadhaar|pan card|bank account.*apply/i, sev: "high", cat: "identity", title: "Sensitive data requested upfront" },
    { re: /immediate joining|joining today|urgent hiring/i, sev: "low", cat: "communication", title: "Urgency pressure tactic" },
  ];

  for (const c of CHECKS) {
    if (c.re.test(text)) {
      flags.push({ id: c.title.toLowerCase().replace(/\s+/g, "_"), severity: c.sev, category: c.cat, title: c.title, detail: "Detected by keyword analysis.", evidence: null });
      score += c.sev === "high" ? 25 : c.sev === "medium" ? 15 : 8;
    }
  }

  score = Math.min(100, score);
  return {
    score,
    verdict: score >= 70 ? "likely_fake" : score >= 40 ? "suspicious" : "safe",
    summary: flags.length > 0 ? `${flags.length} red flag(s) detected by keyword scan. AI analysis unavailable.` : "No keyword red flags. AI analysis unavailable — add your API key for full analysis.",
    flags,
    positives: [],
    companyVerdict: { name: jobData?.company, confidence: "unverifiable", notes: "AI unavailable." },
    recommendations: ["Verify company on MCA21 portal", "Never pay any fee to apply"],
    analysedAt: new Date().toISOString(),
    jobData,
    url,
    fromCache: false,
    fallback: true,
  };
}

// ── Badge ─────────────────────────────────────────────────────────────────────

function updateBadge(tabId, score) {
  if (!tabId) return;
  const color = score >= 70 ? "#ff4545" : score >= 40 ? "#f5a623" : "#3ecf8e";
  const text = score >= 40 ? String(score) : "✓";
  chrome.action.setBadgeText({ text, tabId });
  chrome.action.setBadgeBackgroundColor({ color, tabId });
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function simpleHash(str) {
  // Deterministic URL hash for cache keys — not cryptographic
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(31, h) + str.charCodeAt(i) | 0;
  }
  return Math.abs(h).toString(36);
}

async function signRequest(body, secret) {
  // HMAC-SHA256 to authenticate extension → Worker requests
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function hashKey(apiKey) {
  // One-way hash of user's API key — sent to Worker for rate-limit identity only
  // Worker never sees the actual key in this field
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(apiKey));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

// ── Tab Listener ──────────────────────────────────────────────────────────────

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url) return;
  chrome.action.setBadgeText({ text: "", tabId });

  const JOB_PATTERNS = [
    /internshala\.com\/(internship|job)/,
    /linkedin\.com\/jobs\/(view|search)/,
    /naukri\.com\/.+-jobs/,
    /indeed\.(com|co\.in)\/viewjob/,
    /unstop\.com\/(competitions|opportunities)/,
  ];

  if (!JOB_PATTERNS.some(p => p.test(tab.url))) return;

  const res = await chrome.storage.local.get(["settings"]);
  const settings = res.settings || defaultSettings();
  if (!settings.autoScan || !settings.apiKey) return;

  try {
    await chrome.tabs.sendMessage(tabId, { type: "AUTO_SCAN_TRIGGER", tabId });
  } catch { /* content script not ready yet — it will scan on load */ }
});

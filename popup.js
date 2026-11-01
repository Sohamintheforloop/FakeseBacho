// FakeseBacho — Popup Script

(async function () {
  "use strict";

  // ── State ─────────────────────────────────────────────────────────────────

  let settings = {};
  let currentResult = null;
  let currentJobData = null;
  let currentUrl = null;
  let currentTab = null;

  // ── Init ──────────────────────────────────────────────────────────────────

  async function init() {
    settings = await getSettings();
    await loadCurrentTab();
    setupTabs();
    setupSettings();
    setupReport();
    await runAnalysis();
    await loadHistory();
  }

  async function getSettings() {
    const res = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" });
    return res.data || {};
  }

  async function loadCurrentTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTab = tab;
    currentUrl = tab?.url || "";
  }

  // ── Tab Navigation ────────────────────────────────────────────────────────

  function setupTabs() {
    document.querySelectorAll(".tab").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.tab;
        document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
        document.querySelectorAll(".tab-panel").forEach(p => (p.style.display = "none"));
        btn.classList.add("active");
        document.getElementById("tab-" + id).style.display = "";

        if (id === "history") loadHistory();
      });
    });
  }

  // ── Analysis Flow ─────────────────────────────────────────────────────────

  async function runAnalysis(forceRefresh = false) {
    showState("idle");

    // Must be on a supported URL
    if (!currentTab?.url) return;

    // Ping the content script
    let pingResult;
    try {
      pingResult = await chrome.tabs.sendMessage(currentTab.id, { type: "PING" });
    } catch {
      showState("idle");
      return;
    }

    if (!pingResult?.isJobPage) {
      showState("idle");
      return;
    }

    // Check for API key
    if (!settings.apiKey) {
      showState("nokey");
      return;
    }

    showState("scanning");
    document.getElementById("scanning-platform").textContent =
      pingResult.platform || "Unknown platform";

    // Get cached result from storage first (fast display)
    if (!forceRefresh) {
      const cached = await chrome.storage.local.get(["currentPageAnalysis"]);
      const stored = cached.currentPageAnalysis;
      if (stored && stored.url === currentUrl && Date.now() - stored.timestamp < 24 * 60 * 60 * 1000) {
        currentResult = stored.result;
        currentJobData = stored.jobData;
        renderResult(currentResult, true);
        loadReportCount();
        return;
      }
    }

    // Request content script to extract and analyze
    try {
      const jobDataRes = await chrome.tabs.sendMessage(currentTab.id, { type: "GET_CURRENT_JOB_DATA" });
      if (!jobDataRes.ok || !jobDataRes.data) throw new Error("Extraction failed");
      currentJobData = jobDataRes.data;
    } catch {
      // Use fallback extraction via background
      currentJobData = { platform: pingResult.platform, url: currentUrl, title: currentTab.title };
    }

    const analysisRes = await chrome.runtime.sendMessage({
      type: "ANALYZE_JOB",
      payload: {
        jobData: currentJobData,
        url: currentUrl,
        forceRefresh,
      },
    });

    if (analysisRes.ok) {
      currentResult = analysisRes.data;
      renderResult(currentResult, false);
      loadReportCount();
    } else {
      showError(analysisRes.error);
    }
  }

  // ── Render Result ─────────────────────────────────────────────────────────

  function renderResult(result, fromCache) {
    showState("result");

    // Platform tag
    el("r-platform").textContent = result.jobData?.platform || "Job Listing";

    // Cache note
    if (fromCache || result.fromCache) {
      el("r-cache-note").style.display = "";
    } else {
      el("r-cache-note").style.display = "none";
    }

    // Score gauge
    drawGauge(result.score);
    el("r-score").textContent = result.score;

    // Verdict badge
    const vBadge = el("r-verdict-badge");
    vBadge.className = "score-verdict";
    const { cls, icon, text } = verdictMeta(result.verdict, result.score);
    vBadge.classList.add(cls);
    vBadge.innerHTML = `<span class="verdict-dot"></span> ${icon} ${text}`;

    // Summary
    el("r-summary").textContent = result.summary;

    // Job info
    const job = result.jobData || {};
    el("r-job-info").innerHTML = [
      job.title ? `<span class="ji-title">${esc(job.title)}</span>` : "",
      job.company ? `<span class="ji-co">${esc(job.company)}</span>` : "",
    ].filter(Boolean).join(" · ");

    // Company verdict
    const cv = result.companyVerdict || {};
    el("r-company-name").textContent = cv.name || job.company || "Unknown";
    const confEl = el("r-company-conf");
    confEl.className = "company-confidence conf-" + (cv.confidence || "unverifiable");
    confEl.textContent = confLabel(cv.confidence);
    el("r-company-notes").textContent = cv.notes || "";

    // Flags
    const flagsSection = el("section-flags");
    const flagsList = el("flags-list");
    if (result.flags?.length > 0) {
      flagsList.innerHTML = result.flags.map(flag => `
        <div class="flag-item sev-${flag.severity}">
          <div class="flag-top">
            <span class="flag-sev">${flag.severity.toUpperCase()}</span>
            <span class="flag-cat">${flag.category}</span>
            <span class="flag-title">${esc(flag.title)}</span>
          </div>
          <p class="flag-detail">${esc(flag.detail)}</p>
          ${flag.evidence ? `<div class="flag-evidence">"${esc(flag.evidence)}"</div>` : ""}
        </div>
      `).join("");
      flagsSection.style.display = "";
    } else {
      flagsSection.style.display = "none";
    }

    // Positives
    const posSection = el("section-positives");
    const posList = el("positives-list");
    if (result.positives?.length > 0) {
      posList.innerHTML = result.positives.map(p => `
        <div class="positive-item">
          <span class="pos-icon">✓</span>
          <div><strong>${esc(p.title)}</strong><p>${esc(p.detail)}</p></div>
        </div>
      `).join("");
      posSection.style.display = "";
    } else {
      posSection.style.display = "none";
    }

    // Recommendations
    const recsSection = el("section-recs");
    const recsList = el("recs-list");
    if (result.recommendations?.length > 0) {
      recsList.innerHTML = result.recommendations.map(r => `<li>${esc(r)}</li>`).join("");
      recsSection.style.display = "";
    } else {
      recsSection.style.display = "none";
    }

    // Analysed at
    if (result.analysedAt) {
      const d = new Date(result.analysedAt);
      el("r-analysed-at").textContent = "Analysed " + d.toLocaleDateString("en-IN", {
        day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"
      });
    }
  }

  // ── Gauge Canvas ──────────────────────────────────────────────────────────

  function drawGauge(score) {
    const canvas = document.getElementById("gauge-canvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    const W = 180, H = 90;
    canvas.width = W * 2;
    canvas.height = H * 2;
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.scale(2, 2);

    const cx = W / 2, cy = H - 8;
    const r = 66;
    const startAngle = Math.PI;
    const endAngle = 0;
    const scoreAngle = startAngle + (score / 100) * Math.PI;

    // Track
    ctx.beginPath();
    ctx.arc(cx, cy, r, startAngle, endAngle);
    ctx.strokeStyle = "rgba(255,255,255,0.07)";
    ctx.lineWidth = 10;
    ctx.lineCap = "round";
    ctx.stroke();

    // Color based on score
    const gaugeColor = score >= 70 ? "#ff4545" : score >= 40 ? "#f5a623" : "#3ecf8e";

    // Fill arc
    ctx.beginPath();
    ctx.arc(cx, cy, r, startAngle, scoreAngle);
    ctx.strokeStyle = gaugeColor;
    ctx.lineWidth = 10;
    ctx.lineCap = "round";
    ctx.stroke();

    // Needle dot
    const nx = cx + r * Math.cos(scoreAngle);
    const ny = cy + r * Math.sin(scoreAngle);
    ctx.beginPath();
    ctx.arc(nx, ny, 5, 0, Math.PI * 2);
    ctx.fillStyle = gaugeColor;
    ctx.fill();
  }

  // ── Verdict Meta ──────────────────────────────────────────────────────────

  function verdictMeta(verdict, score) {
    if (verdict === "definite_scam" || score >= 80)
      return { cls: "vd-danger", icon: "🚨", text: "DEFINITE SCAM" };
    if (verdict === "likely_fake" || score >= 60)
      return { cls: "vd-danger", icon: "⚠️", text: "LIKELY FAKE" };
    if (verdict === "suspicious" || score >= 35)
      return { cls: "vd-warn", icon: "⚡", text: "SUSPICIOUS" };
    return { cls: "vd-safe", icon: "✅", text: "LOOKS SAFE" };
  }

  function confLabel(conf) {
    return {
      verified: "✓ Verified",
      unverifiable: "? Unverifiable",
      suspicious: "⚠ Suspicious",
      known_scammer: "🚨 Known Scammer",
    }[conf] || "Unknown";
  }

  // ── History Tab ───────────────────────────────────────────────────────────

  async function loadHistory() {
    const res = await chrome.storage.local.get(["analysisHistory"]);
    const history = res.analysisHistory || [];

    const listEl = el("history-list");
    const emptyEl = el("history-empty");

    if (history.length === 0) {
      emptyEl.style.display = "";
      listEl.innerHTML = "";
      return;
    }

    emptyEl.style.display = "none";
    listEl.innerHTML = history.slice(0, 20).map(item => {
      const { cls } = verdictMeta(item.verdict, item.score);
      return `
        <div class="history-item" data-url="${esc(item.url)}">
          <div class="hi-top">
            <span class="hi-score ${cls}">${item.score}</span>
            <span class="hi-platform">${esc(item.platform || "")}</span>
          </div>
          <div class="hi-title">${esc(item.title || "Unknown role")}</div>
          <div class="hi-company">${esc(item.company || "")}</div>
          <div class="hi-date">${new Date(item.analysedAt).toLocaleDateString("en-IN", { day:"numeric", month:"short" })}</div>
        </div>
      `;
    }).join("");

    // Click to navigate
    listEl.querySelectorAll(".history-item").forEach(item => {
      item.addEventListener("click", () => {
        const url = item.dataset.url;
        chrome.tabs.create({ url });
      });
    });
  }

  // ── Settings ──────────────────────────────────────────────────────────────

  function setupSettings() {
    // Load settings into UI
    const keyInput = el("input-api-key");
    keyInput.value = settings.apiKey || "";
    el("toggle-autoscan").checked = settings.autoScan !== false;
    el("toggle-badge").checked = settings.showBadge !== false;
    el("toggle-history").checked = settings.analysisHistory !== false;
    el("select-sensitivity").value = settings.sensitivityLevel || "medium";

    // Open / close
    el("btn-settings").addEventListener("click", () => {
      el("settings-overlay").style.display = "";
    });
    el("btn-close-settings").addEventListener("click", () => {
      el("settings-overlay").style.display = "none";
    });
    el("btn-go-settings").addEventListener("click", () => {
      el("state-nokey").style.display = "none";
      el("settings-overlay").style.display = "";
    });

    // Show/hide key
    el("btn-show-key").addEventListener("click", () => {
      keyInput.type = keyInput.type === "password" ? "text" : "password";
    });

    // Save
    el("btn-save-settings").addEventListener("click", async () => {
      const apiKey = keyInput.value.trim();

      if (apiKey && !apiKey.startsWith("sk-ant-")) {
        showApiKeyStatus("error", "Key should start with sk-ant-…");
        return;
      }

      const newSettings = {
        ...settings,
        apiKey,
        autoScan: el("toggle-autoscan").checked,
        showBadge: el("toggle-badge").checked,
        analysisHistory: el("toggle-history").checked,
        sensitivityLevel: el("select-sensitivity").value,
        consentGiven: true,
      };

      await chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", payload: newSettings });
      settings = newSettings;
      showApiKeyStatus("ok", "Settings saved ✓");
      setTimeout(() => {
        el("settings-overlay").style.display = "none";
        if (apiKey) runAnalysis(false);
      }, 800);
    });

    // Clear data
    el("btn-clear-data").addEventListener("click", async () => {
      if (confirm("Clear all FakeseBacho data (history, cache, reports)?")) {
        await chrome.storage.local.clear();
        settings = {};
        alert("Data cleared.");
        el("settings-overlay").style.display = "none";
        init();
      }
    });

    // Rescan buttons
    el("btn-rescan-full")?.addEventListener("click", () => runAnalysis(true));
    el("btn-rescan")?.addEventListener("click", () => runAnalysis(true));
    el("btn-retry")?.addEventListener("click", () => runAnalysis(false));
  }

  function showApiKeyStatus(type, msg) {
    const s = el("api-key-status");
    s.style.display = "";
    s.className = "api-key-status api-key-" + type;
    s.textContent = msg;
  }

  // ── Report Modal ──────────────────────────────────────────────────────────

  function setupReport() {
    el("btn-report").addEventListener("click", () => {
      el("report-modal").style.display = "";
    });

    el("btn-close-report").addEventListener("click", closeReport);
    el("btn-cancel-report").addEventListener("click", closeReport);

    // Enable submit only when at least one reason checked
    el("report-reasons").addEventListener("change", () => {
      const checked = el("report-reasons").querySelectorAll("input:checked");
      el("btn-submit-report").disabled = checked.length === 0;
    });

    el("btn-submit-report").addEventListener("click", async () => {
      const reasons = [...el("report-reasons").querySelectorAll("input:checked")].map(i => i.value);
      const note = el("report-note").value.trim();

      const res = await chrome.runtime.sendMessage({
        type: "SUBMIT_REPORT",
        payload: {
          url: currentUrl,
          reasons,
          jobData: currentJobData,
          userNote: note,
        },
      });

      if (res.ok) {
        closeReport();
        el("r-report-count").textContent = res.data.totalReports;
        showToast("Report submitted. Thank you!");
      }
    });
  }

  async function loadReportCount() {
    if (!currentUrl) return;
    const res = await chrome.runtime.sendMessage({
      type: "GET_REPORTS_FOR_URL",
      payload: { url: currentUrl },
    });
    if (res.ok) {
      el("r-report-count").textContent = res.data.count;
    }
  }

  function closeReport() {
    el("report-modal").style.display = "none";
    el("report-note").value = "";
    el("report-reasons").querySelectorAll("input").forEach(i => (i.checked = false));
    el("btn-submit-report").disabled = true;
  }

  // ── State Display ─────────────────────────────────────────────────────────

  function showState(state) {
    ["idle", "nokey", "scanning", "result", "error"].forEach(s => {
      const panel = document.getElementById("state-" + s);
      if (panel) panel.style.display = s === state ? "" : "none";
    });
  }

  function showError(errCode) {
    showState("error");
    const msgs = {
      NO_API_KEY: "Add your Anthropic API key in Settings to enable analysis.",
      INVALID_API_KEY: "Invalid API key. Check Settings and try again.",
      RATE_LIMITED: "API rate limit hit. Please wait a moment and retry.",
    };
    el("error-msg").textContent = msgs[errCode] || "Analysis failed (" + (errCode || "unknown error") + "). Please retry.";
  }

  // ── Toast ─────────────────────────────────────────────────────────────────

  function showToast(msg) {
    let toast = document.getElementById("fd-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "fd-toast";
      toast.className = "fd-toast";
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add("visible");
    setTimeout(() => toast.classList.remove("visible"), 2500);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function el(id) { return document.getElementById(id); }

  function esc(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ── Boot ──────────────────────────────────────────────────────────────────

  init().catch(console.error);
})();

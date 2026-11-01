// FakeseBacho — Content Script
// Extracts job data from supported platforms and injects the scan badge

(function () {
  "use strict";

  // Prevent double-injection
  if (window.__fakeDetectInjected) return;
  window.__fakeDetectInjected = true;

  const PLATFORM = detectPlatform();
  let currentJobData = null;
  let scanBadgeEl = null;
  let hasScanned = false;

  // ── Platform Detection ────────────────────────────────────────────────────

  function detectPlatform() {
    const host = window.location.hostname.replace("www.", "");
    if (host.includes("internshala")) return "Internshala";
    if (host.includes("linkedin")) return "LinkedIn";
    if (host.includes("naukri")) return "Naukri";
    if (host.includes("shine")) return "Shine";
    if (host.includes("indeed")) return "Indeed";
    if (host.includes("unstop")) return "Unstop";
    return "Unknown";
  }

  // ── Job Data Extractors ──────────────────────────────────────────────────

  const EXTRACTORS = {
    Internshala: extractInternshala,
    LinkedIn: extractLinkedIn,
    Naukri: extractNaukri,
    Shine: extractShine,
    Indeed: extractIndeed,
    Unstop: extractUnstop,
  };

  function extractInternshala() {
    const get = (sel) => document.querySelector(sel)?.innerText?.trim() || "";
    const getAll = (sel) => [...document.querySelectorAll(sel)].map(e => e.innerText.trim()).join(", ");

    // Try internship detail page
    const title = get(".profile")
      || get("h1.heading_4_5")
      || get(".internship_details h1")
      || get("h1");

    const company = get(".company_name a")
      || get(".company-name")
      || get(".heading_4_5 a")
      || get(".company_name");

    const location = getAll(".location_link")
      || get(".locations_strip")
      || get("#location_names")
      || get(".location");

    const salary = get(".stipend")
      || get(".salary")
      || get("#stipend-value")
      || get(".stipend_salary");

    const duration = get(".duration")
      || get(".internship-duration")
      || get("#duration-value");

    const description = get("#about_internship_container .internship_other_details_container")
      || get(".internship_details_container .detail-wrap")
      || get("#about-us")
      || get(".internship_details")
      || get("[data-section='about-internship']");

    const requirements = get("#about_applicant")
      || get(".about_applicant_container")
      || get(".skills_section");

    const perks = getAll(".individual_perk")
      || get("#perks_container");

    const postedBy = get(".company_name a")
      || get(".internship_posted_by");

    const openings = get("#no_of_openings")
      || get(".number_of_openings")
      || get("[data-label='No. of openings']");

    const applicants = get("#number_of_applications")
      || get(".applications_count");

    const postedDate = get(".status-success")
      || get(".posted_by_container .text-muted")
      || get(".time");

    const additionalInfo = getAll(".internship_other_details_container .detail")
      + " " + get(".important_instruction");

    return {
      platform: "Internshala",
      url: window.location.href,
      title: title || document.title,
      company,
      location,
      salary,
      duration,
      description: cleanText(description),
      requirements: cleanText(requirements),
      perks,
      postedBy,
      openings,
      applicants,
      postedDate,
      additionalInfo: cleanText(additionalInfo),
    };
  }

  function extractLinkedIn() {
    const get = (sel) => document.querySelector(sel)?.innerText?.trim() || "";

    const title = get(".job-details-jobs-unified-top-card__job-title")
      || get(".jobs-unified-top-card__job-title")
      || get("h1.t-24");

    const company = get(".job-details-jobs-unified-top-card__company-name")
      || get(".jobs-unified-top-card__company-name")
      || get(".jobs-details-top-card__company-url");

    const location = get(".job-details-jobs-unified-top-card__bullet")
      || get(".jobs-unified-top-card__workplace-type");

    const salary = get(".jobs-unified-top-card__job-insight")
      || get(".compensation__salary");

    const description = get(".jobs-description__content .jobs-box__html-content")
      || get(".description__text");

    return {
      platform: "LinkedIn",
      url: window.location.href,
      title,
      company,
      location,
      salary,
      duration: "",
      description: cleanText(description),
      requirements: "",
      perks: "",
      postedBy: company,
      openings: "",
      applicants: get(".num-applicants__caption") || get(".jobs-unified-top-card__applicant-count"),
      postedDate: get(".jobs-unified-top-card__posted-date"),
      additionalInfo: "",
    };
  }

  function extractNaukri() {
    const get = (sel) => document.querySelector(sel)?.innerText?.trim() || "";
    const getAll = (sel) => [...document.querySelectorAll(sel)].map(e => e.innerText.trim()).join(", ");

    return {
      platform: "Naukri",
      url: window.location.href,
      title: get("h1.jd-header-title") || get(".jd-header h1") || get("h1"),
      company: get(".jd-header-comp-name") || get(".org-link") || get(".company-name"),
      location: getAll(".loc.tooltip-container") || get(".loc") || get("[class*='location']"),
      salary: get(".salary-container") || get("[class*='salary']"),
      duration: "",
      description: cleanText(get(".job-desc") || get(".jd-desc") || get("[class*='description']")),
      requirements: cleanText(getAll(".chip-holder .chip") || get("[class*='requirement']")),
      perks: getAll(".perks-item"),
      postedBy: get(".jd-header-comp-name"),
      openings: get("[class*='openings']"),
      applicants: get("[class*='applicants']"),
      postedDate: get(".other-details span") || get("[class*='posted']"),
      additionalInfo: get("[class*='additional']"),
    };
  }

  function extractShine() {
    const get = (sel) => document.querySelector(sel)?.innerText?.trim() || "";
    return {
      platform: "Shine",
      url: window.location.href,
      title: get("h1.jobtitle") || get("h1"),
      company: get(".company-name") || get(".company"),
      location: get(".job-location") || get(".location"),
      salary: get(".salary-info") || get(".salary"),
      duration: "",
      description: cleanText(get(".job-description") || get(".description")),
      requirements: cleanText(get(".skills-section") || get(".requirements")),
      perks: "",
      postedBy: get(".company-name"),
      openings: "",
      applicants: "",
      postedDate: get(".posted-on") || get(".date"),
      additionalInfo: "",
    };
  }

  function extractIndeed() {
    const get = (sel) => document.querySelector(sel)?.innerText?.trim() || "";
    return {
      platform: "Indeed",
      url: window.location.href,
      title: get('[data-testid="jobsearch-JobInfoHeader-title"]') || get("h1.jobsearch-JobInfoHeader-title") || get("h1"),
      company: get('[data-testid="inlineHeader-companyName"]') || get(".jobsearch-InlineCompanyRating-companyHeader"),
      location: get('[data-testid="job-location"]') || get(".jobsearch-JobInfoHeader-subtitle .icl-u-xs-mt--xs"),
      salary: get('[data-testid="attribute_snippet_compensation"]') || get(".salary-snippet"),
      duration: "",
      description: cleanText(get('[data-testid="jobsearch-jobDescriptionText"]') || get(".jobsearch-jobDescriptionText")),
      requirements: "",
      perks: "",
      postedBy: get('[data-testid="inlineHeader-companyName"]'),
      openings: "",
      applicants: "",
      postedDate: get('[data-testid="myJobsStateDate"]'),
      additionalInfo: "",
    };
  }

  function extractUnstop() {
    const get = (sel) => document.querySelector(sel)?.innerText?.trim() || "";
    return {
      platform: "Unstop",
      url: window.location.href,
      title: get("h1.opp_title") || get("h1.title") || get("h1"),
      company: get(".company_name") || get(".org-name") || get(".company"),
      location: get(".location") || get("[class*='location']"),
      salary: get(".prize_money") || get(".stipend") || get("[class*='prize']"),
      duration: get(".duration"),
      description: cleanText(get(".description-section") || get(".about-section") || get(".description")),
      requirements: cleanText(get(".eligibility") || get(".skills")),
      perks: "",
      postedBy: get(".company_name") || get(".org-name"),
      openings: get(".seats") || get(".openings"),
      applicants: get(".registered_count") || get(".applicants"),
      postedDate: get(".deadline") || get(".date"),
      additionalInfo: "",
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function cleanText(text) {
    if (!text) return "";
    return text
      .replace(/\s+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, 3000); // Token limit safety
  }

  function isJobDetailPage() {
    const url = window.location.href;
    const DETAIL_PATTERNS = [
      /internshala\.com\/(internship|job)\/detail\//,
      /internshala\.com\/internships\/detail\//,
      /internshala\.com\/jobs\/detail\//,
      /internshala\.com\/internship\/.*-\d+$/,
      /linkedin\.com\/jobs\/view\//,
      /naukri\.com\/.+-\d+$/,
      /naukri\.com\/job-listings\//,
      /shine\.com\/job-search\/.+/,
      /indeed\.(com|co\.in)\/viewjob/,
      /indeed\.(com|co\.in)\/jobs\?jk=/,
      /unstop\.com\/(competitions|opportunities)\/.+/,
    ];
    return DETAIL_PATTERNS.some(p => p.test(url));
  }

  // ── Scan Badge Injection ──────────────────────────────────────────────────

  function injectScanBadge() {
    if (scanBadgeEl) scanBadgeEl.remove();

    scanBadgeEl = document.createElement("div");
    scanBadgeEl.id = "fd-scan-badge";
    scanBadgeEl.innerHTML = `
      <div class="fd-badge-inner">
        <div class="fd-badge-logo">
          <span class="fd-logo-mark">FB</span>
          <span class="fd-logo-text">FakeseBacho</span>
        </div>
        <button class="fd-scan-btn" id="fd-scan-trigger">
          <span class="fd-btn-icon">🔍</span>
          <span class="fd-btn-text">Scan this listing</span>
        </button>
      </div>
    `;

    document.body.appendChild(scanBadgeEl);

    document.getElementById("fd-scan-trigger").addEventListener("click", () => {
      triggerScan(true);
    });
  }

  function updateBadgeScanning() {
    const btn = document.getElementById("fd-scan-trigger");
    if (btn) {
      btn.innerHTML = `<span class="fd-spinner"></span> <span>Analyzing…</span>`;
      btn.disabled = true;
    }
  }

  function updateBadgeResult(result) {
    if (!scanBadgeEl) return;

    const score = result.score;
    let colorClass, icon, label;

    if (score >= 70) {
      colorClass = "fd-danger"; icon = "⚠️";
      label = "HIGH RISK";
    } else if (score >= 40) {
      colorClass = "fd-warn"; icon = "⚡";
      label = "SUSPICIOUS";
    } else {
      colorClass = "fd-safe"; icon = "✅";
      label = "LOOKS SAFE";
    }

    scanBadgeEl.innerHTML = `
      <div class="fd-badge-inner fd-result ${colorClass}">
        <div class="fd-result-header">
          <span class="fd-logo-mark">FB</span>
          <span class="fd-result-label">${icon} ${label}</span>
          <span class="fd-result-score">${score}/100</span>
        </div>
        <p class="fd-result-summary">${escapeHtml(result.summary)}</p>
        ${result.flags.length > 0 ? `
          <div class="fd-flags-mini">
            ${result.flags.slice(0, 2).map(f => `
              <div class="fd-flag-mini fd-sev-${f.severity}">
                <span class="fd-flag-sev">${f.severity.toUpperCase()}</span>
                <span>${escapeHtml(f.title)}</span>
              </div>
            `).join("")}
            ${result.flags.length > 2 ? `<div class="fd-flag-more">+${result.flags.length - 2} more flags — open extension</div>` : ""}
          </div>
        ` : ""}
        <button class="fd-rescan-btn" id="fd-rescan">Re-scan</button>
      </div>
    `;

    document.getElementById("fd-rescan")?.addEventListener("click", () => {
      injectScanBadge();
      triggerScan(true);
    });
  }

  function updateBadgeError(msg) {
    if (!scanBadgeEl) return;
    const isNoKey = msg === "NO_API_KEY";
    scanBadgeEl.innerHTML = `
      <div class="fd-badge-inner fd-error">
        <span class="fd-logo-mark">FB</span>
        <span class="fd-error-msg">
          ${isNoKey
            ? "Add your Anthropic API key in the FakeseBacho extension popup to enable AI analysis."
            : "Analysis failed. Click to retry."}
        </span>
        ${!isNoKey ? `<button class="fd-scan-btn" id="fd-retry"><span>Retry</span></button>` : ""}
      </div>
    `;
    document.getElementById("fd-retry")?.addEventListener("click", () => {
      injectScanBadge();
      triggerScan(true);
    });
  }

  // ── Scan Trigger ──────────────────────────────────────────────────────────

  async function triggerScan(force = false) {
    if (!isJobDetailPage()) return;

    const extractor = EXTRACTORS[PLATFORM];
    if (!extractor) return;

    try {
      currentJobData = extractor();
    } catch (e) {
      console.error("[FakeseBacho] Extraction error:", e);
      currentJobData = {
        platform: PLATFORM,
        url: window.location.href,
        title: document.title,
        description: document.body.innerText.slice(0, 2000),
      };
    }

    updateBadgeScanning();

    const response = await chrome.runtime.sendMessage({
      type: "ANALYZE_JOB",
      payload: {
        jobData: currentJobData,
        url: window.location.href,
        forceRefresh: force,
      },
    });

    if (response.ok) {
      updateBadgeResult(response.data);
      // Store for popup access
      chrome.storage.local.set({
        currentPageAnalysis: {
          result: response.data,
          jobData: currentJobData,
          url: window.location.href,
          timestamp: Date.now(),
        },
      });
    } else {
      updateBadgeError(response.error);
    }
  }

  // ── Message Listener ──────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "AUTO_SCAN_TRIGGER" || msg.type === "REQUEST_SCAN") {
      if (isJobDetailPage()) {
        if (!scanBadgeEl) injectScanBadge();
        triggerScan(false);
      }
      sendResponse({ ok: true });
      return true;
    }

    if (msg.type === "GET_CURRENT_JOB_DATA") {
      const extractor = EXTRACTORS[PLATFORM];
      try {
        const data = extractor ? extractor() : null;
        sendResponse({ ok: true, data });
      } catch {
        sendResponse({ ok: false });
      }
      return true;
    }

    if (msg.type === "PING") {
      sendResponse({ ok: true, platform: PLATFORM, isJobPage: isJobDetailPage() });
      return true;
    }
  });

  // ── Escape Helper ─────────────────────────────────────────────────────────

  function escapeHtml(str) {
    if (!str) return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  function init() {
    if (!isJobDetailPage()) return;

    // Inject badge
    injectScanBadge();

    // Auto-scan if settings allow (checked in background via message)
    chrome.runtime.sendMessage({ type: "AUTO_SCAN_TRIGGER" }).catch(() => {});

    // SPA navigation support (Internshala, LinkedIn use pushState)
    let lastUrl = window.location.href;
    const observer = new MutationObserver(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        hasScanned = false;
        scanBadgeEl?.remove();
        scanBadgeEl = null;

        if (isJobDetailPage()) {
          setTimeout(() => {
            injectScanBadge();
            triggerScan(false);
          }, 1200); // wait for page content to load
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  // Run after DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

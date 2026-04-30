// GrantForge client-side logic — works for both / and /d routes.
// State lives in sessionStorage so Stripe payment redirect doesn't lose it.

const STORAGE_KEY = "grantforge_state_v1";

const SECTIONS = [
  { id: "specific_aims", label: "Specific Aims" },
  { id: "significance", label: "Significance" },
  { id: "innovation", label: "Innovation" },
  { id: "approach", label: "Approach" },
  { id: "commercialization", label: "Commercialization" }
];

// Stripe Payment Link URLs — REPLACE THESE in production with your real links.
// See DEPLOY_GUIDE.md step 5 for how to create them.
const PAYMENT_LINKS = {
  single: "https://buy.stripe.com/test_dRm4gB8Yy99f0MS2NieEo01",
  pack: "https://buy.stripe.com/test_8x27sN0s299fansfA4eEo02"
};

// ---- state ----
function loadState() {
  try { return JSON.parse(sessionStorage.getItem(STORAGE_KEY)) || {}; }
  catch { return {}; }
}
function saveState(s) { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s)); }
function patchState(patch) { saveState({ ...loadState(), ...patch }); }

// ---- API ----
async function api(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

// ---- UI helpers ----
function el(id) { return document.getElementById(id); }
function show(id) { el(id)?.classList.remove("hidden"); }
function hide(id) { el(id)?.classList.add("hidden"); }
function setBusy(buttonId, busy, busyText) {
  const b = el(buttonId);
  if (!b) return;
  if (busy) {
    b.dataset.originalText = b.textContent;
    b.disabled = true;
    b.innerHTML = `<span class="spinner"></span>${busyText || "Working..."}`;
  } else {
    b.disabled = false;
    b.textContent = b.dataset.originalText || b.textContent;
  }
}

// ---- step 1: parse solicitation (free) ----
async function handleParse() {
  const solicitation = el("solicitation").value.trim();
  if (solicitation.length < 100) {
    alert("Paste at least the review criteria, eligibility, and formatting sections of the solicitation.");
    return;
  }
  patchState({ solicitation });
  setBusy("parse-btn", true, "Parsing solicitation...");
  hide("parse-error");
  try {
    const { data } = await api("/api/parse-solicitation", { solicitation });
    patchState({ parsed: data });
    renderParsed(data);
    show("parsed-output");
    show("paywall-section");
    el("parsed-output").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) {
    el("parse-error").textContent = "Couldn't parse: " + e.message;
    show("parse-error");
  } finally {
    setBusy("parse-btn", false);
  }
}

function renderParsed(d) {
  const out = el("parsed-content");
  if (!out) return;
  const checklistHtml = (d.compliance_checklist || []).map(c => `
    <div class="checklist-item">
      <span class="badge ${c.critical ? "badge-critical" : "badge-minor"}">${c.critical ? "Critical" : "Standard"}</span>
      <div><strong>${esc(c.item)}</strong><br><span class="small">${esc(c.section || "")}</span></div>
    </div>`).join("");
  const criteriaHtml = (d.review_criteria || []).map(c => `
    <li><strong>${esc(c.criterion)}</strong>${c.weight ? ` <span class="small">(${esc(c.weight)})</span>` : ""}<br><span class="small">${esc(c.description || "")}</span></li>`).join("");
  const sectionsHtml = (d.required_sections || []).map(s => `
    <li><strong>${esc(s.name)}</strong>${s.page_limit ? ` <span class="small">— ${esc(s.page_limit)}</span>` : ""}</li>`).join("");
  out.innerHTML = `
    <div class="grid grid-2">
      <div><strong>Agency:</strong> ${esc(d.agency || "—")}</div>
      <div><strong>Program:</strong> ${esc(d.program || "—")} ${esc(d.phase || "")}</div>
      <div><strong>Award:</strong> ${esc(d.award_amount || "—")}</div>
      <div><strong>Deadline:</strong> ${esc(d.deadline || "—")}</div>
    </div>
    <h3>Review criteria</h3>
    <ul>${criteriaHtml || "<li>Not detected — add the review criteria portion of your solicitation and re-parse.</li>"}</ul>
    <h3>Required sections</h3>
    <ul>${sectionsHtml || "<li>Not detected.</li>"}</ul>
    <h3>Compliance checklist</h3>
    ${checklistHtml || "<p class='small'>No compliance items detected.</p>"}
    ${(d.missing_info && d.missing_info.length) ? `<h3>Verify in source</h3><ul>${d.missing_info.map(m=>`<li class="small">${esc(m)}</li>`).join("")}</ul>` : ""}
  `;
}

// ---- paywall: redirect to Stripe with state preserved ----
function handlePay(tier) {
  const projectDescription = el("project-desc")?.value?.trim() || "";
  if (projectDescription.length < 100) {
    alert("Add your project description (at least 100 characters) before checkout. It's saved while you pay.");
    el("project-desc")?.focus();
    return;
  }
  patchState({ projectDescription, pendingTier: tier });
  // Append UTM params if present in the current URL so Stripe carries them through.
  const url = new URL(PAYMENT_LINKS[tier]);
  const here = new URL(window.location.href);
  ["utm_source","utm_medium","utm_campaign","utm_term","utm_content"].forEach(k => {
    const v = here.searchParams.get(k);
    if (v) url.searchParams.set(k, v);
  });
  window.location.href = url.toString();
}

// ---- post-payment: detect Stripe redirect, verify, unlock drafting ----
async function detectPostPayment() {
  const u = new URL(window.location.href);
  const sessionId = u.searchParams.get("session_id");
  if (!sessionId) return false;
  setBusy("verify-btn", true, "Verifying payment...");
  try {
    const res = await fetch(`/api/verify-payment?session_id=${encodeURIComponent(sessionId)}`);
    const data = await res.json();
    if (data.paid) {
      patchState({ sessionId, tier: data.tier, paid: true });
      // Clean URL
      window.history.replaceState({}, "", window.location.pathname);
      return true;
    }
    return false;
  } catch (e) {
    console.error("verify failed", e);
    return false;
  }
}

// ---- drafting + scoring ----
async function handleDraft(sectionId) {
  const state = loadState();
  if (!state.paid || !state.sessionId) {
    alert("No paid session detected. Complete checkout first.");
    return;
  }
  const sectionLabel = SECTIONS.find(s => s.id === sectionId)?.label || sectionId;
  const btnId = `draft-${sectionId}`;
  setBusy(btnId, true, `Drafting ${sectionLabel}...`);
  try {
    const r = await api("/api/draft-section", {
      sessionId: state.sessionId,
      section: sectionLabel,
      projectDescription: state.projectDescription,
      parsedSolicitation: state.parsed
    });
    state.drafts = state.drafts || {};
    state.drafts[sectionId] = r.draft;
    saveState(state);
    renderDraft(sectionId, r.draft);
    show(`draft-output-${sectionId}`);
    el(`score-${sectionId}`)?.removeAttribute("disabled");
  } catch (e) {
    alert("Draft failed: " + e.message);
  } finally {
    setBusy(btnId, false);
  }
}

async function handleScore(sectionId) {
  const state = loadState();
  const draft = state.drafts?.[sectionId];
  if (!draft) { alert("Draft this section first."); return; }
  const sectionLabel = SECTIONS.find(s => s.id === sectionId)?.label || sectionId;
  const btnId = `score-${sectionId}`;
  setBusy(btnId, true, "Running reviewer simulation...");
  try {
    const r = await api("/api/score-section", {
      sessionId: state.sessionId,
      section: sectionLabel,
      draft,
      parsedSolicitation: state.parsed
    });
    state.scores = state.scores || {};
    state.scores[sectionId] = r.scorecard;
    saveState(state);
    renderScore(sectionId, r.scorecard);
    show(`score-output-${sectionId}`);
  } catch (e) {
    alert("Score failed: " + e.message);
  } finally {
    setBusy(btnId, false);
  }
}

function renderDraft(sectionId, draft) {
  const t = el(`draft-text-${sectionId}`);
  if (t) t.textContent = draft;
}

function renderScore(sectionId, sc) {
  const out = el(`score-content-${sectionId}`);
  if (!out) return;
  const isNih = sc.scoring_scale?.includes("1-9");
  const score = sc.overall_score;
  const scoreClass = isNih
    ? (score <= 3 ? "score-good" : score <= 6 ? "score-mid" : "score-bad")
    : (score >= 4 ? "score-good" : score >= 3 ? "score-mid" : "score-bad");

  const critsHtml = (sc.criterion_scores || []).map(c => `
    <div class="card">
      <strong>${esc(c.criterion)}</strong> — <span class="${scoreClass}">${c.score}</span>
      <p class="small">${esc(c.rationale)}</p>
      ${c.quoted_evidence ? `<p class="small" style="font-style:italic">"${esc(c.quoted_evidence)}"</p>` : ""}
    </div>`).join("");

  const issuesHtml = ["fatal_flaws","major_concerns","minor_issues"].map(k => {
    const items = sc[k] || [];
    if (!items.length) return "";
    const cls = k === "fatal_flaws" ? "badge-critical" : k === "major_concerns" ? "badge-major" : "badge-minor";
    const label = k.replace(/_/g," ");
    return `<h3>${label}</h3>` + items.map(i => `
      <div class="card">
        <span class="badge ${cls}">${label}</span>
        <p><strong>${esc(i.issue)}</strong></p>
        ${i.location ? `<p class="small">${esc(i.location)}</p>` : ""}
        <p><strong>Fix:</strong> ${esc(i.fix)}</p>
      </div>`).join("");
  }).join("");

  const revHtml = (sc.top_3_revisions || []).map(r => `
    <div class="card">
      <strong>#${r.priority}</strong> ${esc(r.action)}<br>
      <span class="small">Expected lift: ${esc(r.expected_score_lift || "—")}</span>
    </div>`).join("");

  out.innerHTML = `
    <div style="text-align:center; margin: 16px 0;">
      <div class="score-large ${scoreClass}">${score}</div>
      <div class="small">${esc(sc.scoring_scale || "")}</div>
      <div><strong>${esc(sc.overall_verdict || "")}</strong></div>
    </div>
    <h3>By criterion</h3>${critsHtml}
    ${issuesHtml}
    <h3>Top 3 revisions, in priority order</h3>${revHtml}
  `;
}

function copyDraft(sectionId) {
  const draft = loadState().drafts?.[sectionId];
  if (!draft) return;
  navigator.clipboard.writeText(draft).then(() => {
    const btn = el(`copy-${sectionId}`);
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = "Copied ✓";
      setTimeout(() => btn.textContent = orig, 1500);
    }
  });
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

// ---- bootstrap ----
document.addEventListener("DOMContentLoaded", async () => {
  // Restore previous state if user returned mid-flow
  const state = loadState();
  if (state.solicitation && el("solicitation")) el("solicitation").value = state.solicitation;
  if (state.projectDescription && el("project-desc")) el("project-desc").value = state.projectDescription;
  if (state.parsed) {
    renderParsed(state.parsed);
    show("parsed-output");
    show("paywall-section");
  }

  // Wire buttons
  el("parse-btn")?.addEventListener("click", handleParse);
  el("pay-single-btn")?.addEventListener("click", () => handlePay("single"));
  el("pay-pack-btn")?.addEventListener("click", () => handlePay("pack"));

  // Detect post-payment redirect
  const justPaid = await detectPostPayment();
  if (justPaid || (state.paid && state.sessionId)) {
    show("workspace");
    renderWorkspace();
    el("workspace")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
});

function renderWorkspace() {
  const wrap = el("workspace-sections");
  if (!wrap) return;
  const state = loadState();
  const allowed = state.tier === "pack" ? SECTIONS : SECTIONS.slice(0, 1);

  wrap.innerHTML = allowed.map(s => `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
        <h2 style="margin:0">${s.label}</h2>
        <div>
          <button class="btn" id="draft-${s.id}">Draft this section</button>
          <button class="btn btn-secondary" id="score-${s.id}" disabled>Score it</button>
        </div>
      </div>
      <div id="draft-output-${s.id}" class="hidden" style="margin-top:16px">
        <h3>Draft</h3>
        <pre id="draft-text-${s.id}"></pre>
        <button class="btn btn-secondary" id="copy-${s.id}" style="margin-top:8px">Copy draft</button>
      </div>
      <div id="score-output-${s.id}" class="hidden" style="margin-top:16px">
        <h3>Reviewer scorecard</h3>
        <div id="score-content-${s.id}"></div>
      </div>
    </div>
  `).join("");

  allowed.forEach(s => {
    el(`draft-${s.id}`)?.addEventListener("click", () => handleDraft(s.id));
    el(`score-${s.id}`)?.addEventListener("click", () => handleScore(s.id));
    el(`copy-${s.id}`)?.addEventListener("click", () => copyDraft(s.id));

    // Restore prior drafts/scores if user returns
    const state = loadState();
    if (state.drafts?.[s.id]) {
      renderDraft(s.id, state.drafts[s.id]);
      show(`draft-output-${s.id}`);
      el(`score-${s.id}`)?.removeAttribute("disabled");
    }
    if (state.scores?.[s.id]) {
      renderScore(s.id, state.scores[s.id]);
      show(`score-output-${s.id}`);
    }
  });
}

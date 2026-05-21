import express from "express";

const app = express();
app.use(express.json({ limit: "2mb" }));

const API_KEY = process.env.AIRTABLE || process.env.AIRTABLE_API_KEY || "";
const BASE_ID = process.env.AIRTABLE_BASE_ID || "app1ulAFNbDuizG4n";
const PROGRAMS_TABLE = process.env.AIRTABLE_PROGRAMS_TABLE || "tblb080LKdZLFit2x";
const ACTIONS_TABLE = process.env.AIRTABLE_ACTIONS_TABLE || "tblaMHswXQx4r9ba1";

function esc(v: any): string {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function recordId(req: any): string {
  const q = req.query?.recordId;
  if (typeof q === "string" && q.trim()) return decodeURIComponent(q.trim());
  const m = String(req.url || "").match(/[?&]recordId=([^&]+)/);
  return m?.[1] ? decodeURIComponent(m[1].trim()) : "";
}

function display(v: any, fallback = ""): string {
  if (Array.isArray(v)) return v.map(x => x?.name || x).filter(Boolean).join(", ") || fallback;
  if (v === undefined || v === null || v === "") return fallback;
  if (typeof v === "object") return v.name || v.id || fallback;
  return String(v);
}

function field(f: any, names: string | string[], fallback = ""): string {
  const arr = Array.isArray(names) ? names : [names];
  for (const n of arr) {
    const v = display(f?.[n], "");
    if (v) return v;
  }
  return fallback;
}

function raw(f: any, names: string | string[]): any {
  const arr = Array.isArray(names) ? names : [names];
  for (const n of arr) {
    const v = f?.[n];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
}

function n(v: any): number | null {
  if (Array.isArray(v)) return v.length ? n(v[0]) : null;
  if (v === undefined || v === null || v === "") return null;
  const x = Number(String(v).replace("%", "").trim());
  if (Number.isNaN(x)) return null;
  return x > 1 && x <= 100 ? x / 100 : x;
}

function pct(v: any): string {
  const x = n(v);
  return x === null ? "—" : `${Math.round(x * 100)}%`;
}

function color(v: any): string {
  const x = n(v);
  if (x === null) return "#94a3b8";
  if (x >= 0.8) return "#07923b";
  if (x >= 0.6) return "#2563eb";
  if (x >= 0.4) return "#f97316";
  return "#dc2626";
}

function scoreLabel(v: any): string {
  const x = n(v);
  if (x === null) return "No data";
  if (x >= 0.8) return "Strong";
  if (x >= 0.6) return "Moderate";
  if (x >= 0.4) return "Weak";
  return "Critical";
}

function riskLabel(v: any): string {
  const x = n(v);
  if (x === null) return "No data";
  if (x >= 0.8) return "Low";
  if (x >= 0.6) return "Moderate";
  if (x >= 0.4) return "High";
  return "Critical";
}

async function afetch(url: string) {
  if (!API_KEY) throw new Error("Missing AIRTABLE or AIRTABLE_API_KEY.");
  const r = await fetch(url, { headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" } });
  const t = await r.text();
  if (!r.ok) throw new Error(`Airtable ${r.status}: ${t}`);
  return JSON.parse(t);
}

async function fetchProgram(id: string) {
  const formula = `OR(RECORD_ID()="${id}",{Program ID}="${id}")`;
  const base = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(PROGRAMS_TABLE)}`;
  const rawParams = new URLSearchParams({ filterByFormula: formula, maxRecords: "1" });
  const strParams = new URLSearchParams({ filterByFormula: formula, maxRecords: "1", cellFormat: "string", timeZone: "Europe/Paris", userLocale: "en-us" });
  const [rawData, strData] = await Promise.all([afetch(`${base}?${rawParams}`), afetch(`${base}?${strParams}`)]);
  if (!rawData.records?.length) throw new Error(`No Program found: ${id}`);
  const rr = rawData.records[0];
  const sr = strData.records?.[0] || rr;
  return { id: rr.id, raw: rr.fields || {}, str: sr.fields || {}, linkedActions: rr.fields?.["Linked Actions"] || [] };
}

async function fetchAction(id: string) {
  try {
    const params = new URLSearchParams({ cellFormat: "string", timeZone: "Europe/Paris", userLocale: "en-us" });
    return await afetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(ACTIONS_TABLE)}/${id}?${params}`);
  } catch {
    return null;
  }
}

async function fetchActions(program: any) {
  const ids = Array.isArray(program.linkedActions) ? program.linkedActions : [];
  const rows = await Promise.all(ids.map(fetchAction));
  return rows.filter(Boolean);
}

function point(i: number, total: number, value: number, cx: number, cy: number, r: number) {
  const a = -Math.PI / 2 + (2 * Math.PI * i) / total;
  return { x: cx + r * value * Math.cos(a), y: cy + r * value * Math.sin(a) };
}

function radar(scores: any[]) {
  const cx = 175, cy = 168, r = 100, total = scores.length;
  const avg = scores.reduce((s, x) => s + (n(x.value) ?? 0), 0) / Math.max(1, total);
  const rings = [0.25, 0.5, 0.75, 1].map(level => {
    const ps = scores.map((_, i) => point(i, total, level, cx, cy, r)).map(p => `${p.x},${p.y}`).join(" ");
    return `<polygon points="${ps}" fill="none" stroke="#e5e7eb"/>`;
  }).join("");
  const axes = scores.map((_, i) => {
    const p = point(i, total, 1, cx, cy, r);
    return `<line x1="${cx}" y1="${cy}" x2="${p.x}" y2="${p.y}" stroke="#e5e7eb"/>`;
  }).join("");
  const poly = scores.map((s, i) => point(i, total, n(s.value) ?? 0, cx, cy, r)).map(p => `${p.x},${p.y}`).join(" ");
  const labels = scores.map((s, i) => {
    const p = point(i, total, 1.2, cx, cy, r);
    return `<text x="${p.x}" y="${p.y}" text-anchor="middle" dominant-baseline="middle" font-size="12" font-weight="800" fill="#07164a">${s.key}</text>`;
  }).join("");
  const dots = scores.map((s, i) => {
    const p = point(i, total, n(s.value) ?? 0, cx, cy, r);
    return `<circle cx="${p.x}" cy="${p.y}" r="6" fill="${color(s.value)}"/>`;
  }).join("");
  return `<svg viewBox="0 0 350 330" class="radar-svg">${rings}${axes}<polygon points="${poly}" fill="rgba(37,99,235,.13)" stroke="#2563eb" stroke-width="3"/>${dots}${labels}<circle cx="${cx}" cy="${cy}" r="50" fill="#f8fafc" stroke="#e5e7eb"/><text x="${cx}" y="${cy - 7}" text-anchor="middle" font-size="13">Governance</text><text x="${cx}" y="${cy + 23}" text-anchor="middle" font-size="30" font-weight="900" fill="#2563eb">${pct(avg)}</text></svg>`;
}

function gauge(value: any, label: string) {
  const x = Math.min(1, Math.max(0, n(value) ?? 0));
  const deg = 90 - x * 180;
  return `<div class="gauge-wrap"><svg viewBox="0 0 260 145" class="gauge"><path d="M40 125 A90 90 0 0 1 220 125" fill="none" stroke="#e5e7eb" stroke-width="18" stroke-linecap="round"/><path d="M40 125 A90 90 0 0 1 105 42" fill="none" stroke="#dc2626" stroke-width="18" stroke-linecap="round"/><path d="M105 42 A90 90 0 0 1 160 42" fill="none" stroke="#fbbf24" stroke-width="18" stroke-linecap="round"/><path d="M160 42 A90 90 0 0 1 220 125" fill="none" stroke="#07923b" stroke-width="18" stroke-linecap="round"/><line x1="130" y1="125" x2="130" y2="52" stroke="#07164a" stroke-width="7" stroke-linecap="round" transform="rotate(${deg} 130 125)"/><circle cx="130" cy="125" r="8" fill="#07164a"/></svg><div class="gauge-label">${esc(label)}</div><div class="gauge-risk">Governance Risk</div></div>`;
}

function healthRows(scores: any[]) {
  return scores.map(s => {
    const p = Math.round((n(s.value) ?? 0) * 100);
    return `<div class="health-row"><div class="health-name">${s.key} ${esc(s.label)}</div><div class="bar"><div class="bar-fill" style="width:${p}%;background:${color(s.value)}"></div></div><div class="health-pct">${p}%</div></div>`;
  }).join("");
}

function actionRows(actions: any[]) {
  if (!actions.length) return `<tr><td colspan="5">No linked actions available.</td></tr>`;
  return actions.map(a => {
    const f = a.fields || {};
    const id = field(f, ["Action ID", "Action Code"], a.id);
    const name = field(f, ["Action Name", "Name"], "Untitled action");
    const c = raw(f, ["Overall Coherence", "Action Coherence Score", "OCI-O"]);
    const weakest = field(f, ["Weakest Component", "Weakest Layer"], "Not assessed");
    const triggers = display(f["Open Triggers"], "0");
    return `<tr><td><b>${esc(id)}</b><br/><span>${esc(name)}</span></td><td><b style="color:${color(c)}">${pct(c)}</b></td><td>${esc(riskLabel(c))}</td><td>${esc(weakest)}</td><td>${esc(triggers)}</td></tr>`;
  }).join("");
}

function urgent(actions: any[]) {
  const sorted = [...actions].sort((a, b) => (n(raw(a.fields || {}, ["Overall Coherence", "OCI-O"])) ?? 1) - (n(raw(b.fields || {}, ["Overall Coherence", "OCI-O"])) ?? 1)).slice(0, 3);
  if (!sorted.length) return `<div class="urgent-empty">No urgent linked action detected.</div>`;
  return sorted.map(a => {
    const f = a.fields || {};
    const id = field(f, ["Action ID", "Action Code"], a.id);
    const name = field(f, ["Action Name", "Name"], "Untitled action");
    const c = raw(f, ["Overall Coherence", "Action Coherence Score", "OCI-O"]);
    const weakest = field(f, ["Weakest Component", "Weakest Layer"], "Not assessed");
    const level = riskLabel(c);
    return `<div class="urgent-item"><div class="urgent-top"><div><div class="urgent-action">${esc(id)}</div><div class="urgent-name">${esc(name)}</div></div><div class="urgent-level ${level.toLowerCase()}">${esc(level)}</div></div><div class="urgent-reason">Weakest layer: <b>${esc(weakest)}</b> · coherence ${pct(c)}</div></div>`;
  }).join("");
}

function build(program: any, actions: any[]) {
  const f = { ...(program.raw || {}), ...(program.str || {}) };
  const rawOnly = program.raw || {};
  const scores = [
    { key: "C1", label: "Policy Coherence", value: raw(rawOnly, ["Programme C1 Claim-Evidence Score", "C1 Score", "C1 Continuity Score"]) },
    { key: "C2", label: "Operational Coordination", value: raw(rawOnly, ["Programme C2 Claim-Evidence Score", "C2 Score", "C2 Continuity Score"]) },
    { key: "C3", label: "Resource Continuity", value: raw(rawOnly, ["Programme C3 Claim-Evidence Score", "C3 Score", "C3 Continuity Score"]) },
    { key: "C4", label: "Monitoring Reliability", value: raw(rawOnly, ["Programme C4 Claim-Evidence Score", "C4 Score", "C4 Continuity Score"]) },
    { key: "C5", label: "Escalation Readiness", value: raw(rawOnly, ["Programme C5 Claim-Evidence Score", "C5 Score", "C5 Continuity Score"]) },
    { key: "C6", label: "Auditability Integrity", value: raw(rawOnly, ["Programme C6 Claim-Evidence Score", "C6 Score", "C6 Continuity Score"]) }
  ];
  const governanceScore = raw(rawOnly, ["Final Programme Coherence Score", "Program Governance Score", "Program Coherence Score", "Overall Coherence Score"]);
  const continuityScore = raw(rawOnly, ["Final Programme OCI-O Score", "Program Continuity Score", "Programme Stability Index"]);
  const stability = raw(rawOnly, ["Final Programme OCI-D Score", "Action Aggregation Coherence Score", "Programme Stability Index"]);
  const claimCount = field(f, "Programme Claim Count", "0");
  const evidenceLinked = field(f, "Evidence-Linked Claim Count", "0");
  const weakClaims = field(f, "Weak Claims Count", "0");
  return {
    id: field(f, "Program ID", program.id),
    name: field(f, "Program Name", "Programme Governance Dashboard"),
    type: field(f, "Program Type", "Programme"),
    lead: field(f, "Lead Authority", "Not specified"),
    status: field(f, "Status", "Not specified"),
    governanceStatus: field(f, ["Final Programme Coherence Status", "Program Governance State", "Governance Heat Signal"], scoreLabel(governanceScore)),
    governanceScore, continuityScore, stability,
    weakest: field(f, "Weakest Governance Layer", "Not assessed"),
    critical: field(f, "Critical Actions Count", "0"),
    priority: field(f, "Reviewer Priority", "Medium"),
    banner: field(f, "Governance Dashboard Banner", `Programme coherence: ${pct(governanceScore)}. Claims: ${claimCount}; evidence-linked: ${evidenceLinked}; weak claims: ${weakClaims}.`),
    synthesis: field(f, ["Program Governance Summary (AI)", "Program Governance Summary", "Programme OCI-D Rationale"], "No programme governance synthesis available yet."),
    contradictionSeverity: field(f, "Contradiction Severity", "None"),
    contradictions: field(f, ["Cross-Action Contradictions", "Cross-Action Contradictions (AI)"], "No direct contradiction detected; document and action coherence should still be reviewed."),
    reviewerAction: field(f, ["Reviewer Action Required", "Recommended Reviewer Focus"], "Confirm pending governance assumptions and reviewer validation."),
    recommendedFocus: field(f, "Recommended Reviewer Focus", "Validate monitoring ownership, trigger reliability, escalation readiness and evidence closure."),
    policyDiagnosis: field(f, "Policy Diagnosis", "Programme design is progressing but requires strengthening."),
    monitoringDiagnosis: field(f, "Monitoring Diagnosis", "Programme lacks a reliable monitoring system."),
    escalationDiagnosis: field(f, "Escalation Diagnosis", "Programme corrective pathways are weak."),
    auditDiagnosis: field(f, "Audit Trail Diagnosis", "Programme documentation is generally adequate but requires stronger evidence linkage."),
    scores, actions
  };
}

function page(d: any) {
  const risk = riskLabel(d.governanceScore);
  const conditionColor = color(d.governanceScore);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${esc(d.id)} Programme Dashboard</title><style>*{box-sizing:border-box}body{margin:0;background:#f7f9fc;color:#07164a;font-family:Arial,sans-serif;padding:18px}.page{max-width:1680px;margin:0 auto}.header{background:#fff;border:1px solid #e8edf5;border-radius:18px;padding:18px 22px;box-shadow:0 8px 24px rgba(15,23,42,.06);margin-bottom:14px}.topline{display:flex;align-items:center;justify-content:space-between;gap:16px}.interface{font-size:12px;font-weight:900;color:#2563eb;text-transform:uppercase;margin-bottom:10px}.title{font-size:28px;font-weight:900;line-height:1.15}.badge{background:#fff7ed;color:#f97316;padding:7px 12px;border-radius:8px;font-weight:900;font-size:13px}.meta{display:flex;flex-wrap:wrap;gap:24px;margin-top:12px;font-size:13px}.banner{background:#fff7e6;border:1px solid #fed7aa;border-radius:12px;padding:12px 16px;margin-bottom:14px;font-size:14px;font-weight:800;color:#9a3412}.grid-kpi{display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin-bottom:14px}.card{background:#fff;border:1px solid #e8edf5;border-radius:14px;padding:18px;box-shadow:0 8px 24px rgba(15,23,42,.05)}.kpi-title{font-weight:900;font-size:13px;margin-bottom:10px;text-align:center}.kpi-score{font-size:34px;font-weight:900;text-align:center;line-height:1;color:#2563eb}.kpi-sub{text-align:center;margin-top:8px;font-size:12px;font-weight:800;color:#64748b}.grid-main{display:grid;grid-template-columns:1fr 1.05fr 1.05fr;gap:14px;margin-bottom:14px}.section-title{font-size:18px;font-weight:900;margin-bottom:12px}.radar-svg{height:320px;width:100%;display:block}.health-row{display:grid;grid-template-columns:190px 1fr 42px;gap:12px;align-items:center;margin:13px 0}.health-name{font-size:13px;font-weight:900}.bar{height:8px;background:#e5e7eb;border-radius:99px;overflow:hidden}.bar-fill{height:8px;border-radius:99px}.health-pct{text-align:right;font-weight:900;font-size:13px}.gauge-wrap{text-align:center}.gauge{width:84%;max-width:330px}.gauge-label{font-size:25px;color:${conditionColor};font-weight:900;margin-top:-18px}.gauge-risk{color:${conditionColor};font-weight:800}.ai-box{background:#f4f0ff;border-radius:14px;padding:14px;margin-top:8px;font-size:13px;line-height:1.55;max-height:170px;overflow:hidden}.grid-intel{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:14px;margin-bottom:14px}.grid-lower{display:grid;grid-template-columns:1.1fr 1fr;gap:14px;margin-bottom:14px}.table{width:100%;border-collapse:collapse;font-size:12px}.table th{background:#f8fafc;text-align:left;padding:8px;border-bottom:1px solid #e5e7eb}.table td{padding:8px;border-bottom:1px solid #e5e7eb;vertical-align:top}.table span{font-size:11px;color:#64748b}.urgent-item{padding:10px 0;border-bottom:1px solid #fee2e2}.urgent-item:last-child{border-bottom:none}.urgent-top{display:flex;justify-content:space-between;gap:10px}.urgent-action{font-weight:900;color:#991b1b}.urgent-name{font-size:12px;color:#7f1d1d;margin-top:3px}.urgent-level{font-size:11px;font-weight:900;color:white;padding:4px 8px;border-radius:8px;background:#f97316}.urgent-level.critical{background:#dc2626}.urgent-level.high{background:#f97316}.urgent-level.moderate{background:#fbbf24;color:#713f12}.urgent-level.low{background:#16a34a}.urgent-reason{margin-top:8px;font-size:12px;color:#7f1d1d}.contradiction{background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:12px;font-size:13px;line-height:1.5}.priority{background:#eef4ff}.small{font-size:13px;line-height:1.5}@media(max-width:1200px){.grid-kpi,.grid-main,.grid-intel,.grid-lower{grid-template-columns:1fr}.health-row{grid-template-columns:1fr}.health-pct{text-align:left}}</style></head><body><div class="page"><div class="header"><div class="interface">Programme Reviewer Interface</div><div class="topline"><div><div class="title">${esc(d.name)}</div><div class="meta"><div><b>Program ID:</b> ${esc(d.id)}</div><div><b>Lead Authority:</b> ${esc(d.lead)}</div><div><b>Status:</b> ${esc(d.status)}</div><div><b>Type:</b> ${esc(d.type)}</div></div></div><div class="badge">● ${esc(d.governanceStatus)}</div></div></div><div class="grid-kpi"><div class="card"><div class="kpi-title">Governance Condition</div><div class="kpi-score" style="color:${color(d.governanceScore)}">${pct(d.governanceScore)}</div><div class="kpi-sub">Final Programme Coherence</div></div><div class="card"><div class="kpi-title">Continuity Posture</div><div class="kpi-score" style="color:${color(d.continuityScore)}">${pct(d.continuityScore)}</div><div class="kpi-sub">Final OCI-O</div></div><div class="card"><div class="kpi-title">Stability Index</div><div class="kpi-score" style="color:${color(d.stability)}">${pct(d.stability)}</div><div class="kpi-sub">Final OCI-D</div></div><div class="card"><div class="kpi-title">Weakest Layer</div><div class="kpi-score" style="font-size:22px;color:#dc2626">${esc(d.weakest)}</div><div class="kpi-sub">Primary fragility</div></div><div class="card"><div class="kpi-title">Critical Actions</div><div class="kpi-score" style="color:#f97316">${esc(d.critical)}</div><div class="kpi-sub">Below threshold</div></div><div class="card"><div class="kpi-title">Review Priority</div><div class="kpi-score" style="font-size:24px;color:#f97316">${esc(d.priority)}</div><div class="kpi-sub">Reviewer queue</div></div></div><div class="banner">● ${esc(d.banner)}</div><div class="grid-main"><div class="card"><div class="section-title">Governance Condition (C1–C6)</div>${radar(d.scores)}</div><div class="card"><div class="section-title">Governance Health Summary</div>${healthRows(d.scores)}</div><div class="card"><div class="section-title">Governance Risk Indicator</div>${gauge(d.governanceScore, risk)}<div class="ai-box"><b>AI Governance Synthesis</b><br/>${esc(d.synthesis)}</div></div></div><div class="grid-intel"><div class="card"><div class="section-title">Most Urgent Actions</div>${urgent(d.actions)}</div><div class="card"><div class="section-title">Governance Contradictions</div><div class="contradiction"><b>Severity:</b> ${esc(d.contradictionSeverity)}<br/><br/>${esc(d.contradictions)}</div></div><div class="card priority"><div class="section-title">Reviewer Priority Action</div><div class="small">${esc(d.reviewerAction)}</div><br/><div class="section-title">Recommended Focus</div><div class="small">${esc(d.recommendedFocus)}</div></div></div><div class="grid-lower"><div class="card"><div class="section-title">Action Coherence Comparator</div><table class="table"><thead><tr><th>Action</th><th>Coherence</th><th>Risk</th><th>Weakest Layer</th><th>Triggers</th></tr></thead><tbody>${actionRows(d.actions)}</tbody></table></div><div class="card"><div class="section-title">Programme Diagnosis Snapshot</div><div class="small"><b>Policy:</b> ${esc(d.policyDiagnosis)}</div><br/><div class="small"><b>Monitoring:</b> ${esc(d.monitoringDiagnosis)}</div><br/><div class="small"><b>Escalation:</b> ${esc(d.escalationDiagnosis)}</div><br/><div class="small"><b>Auditability:</b> ${esc(d.auditDiagnosis)}</div></div></div></div></body></html>`;
}

app.get("/", (_req, res) => res.redirect("/api"));

app.get("/api", async (req, res) => {
  try {
    const id = recordId(req);
    if (!id) return res.type("html").send(page(build({ id: "Demo", raw: {}, str: {}, linkedActions: [] }, [])));
    const program = await fetchProgram(id);
    const actions = await fetchActions(program);
    return res.type("html").send(page(build(program, actions)));
  } catch (e: any) {
    return res.status(500).type("html").send(`<pre>${esc(e.message || String(e))}</pre>`);
  }
});

app.post("/api", (req, res) => res.type("html").send(page(req.body || {})));

export default app;

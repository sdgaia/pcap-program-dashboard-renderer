import express from "express";

const app = express();
app.use(express.json({ limit: "2mb" }));

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY || "";
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID || "";
const AIRTABLE_PROGRAMS_TABLE =
  process.env.AIRTABLE_PROGRAMS_TABLE || "tblb080LKdZLFit2x";
const AIRTABLE_ACTIONS_TABLE =
  process.env.AIRTABLE_ACTIONS_TABLE || "tblaMHswXQx4r9ba1";

function getRecordId(req: any): string {
  const q = req.query?.recordId;
  if (typeof q === "string" && q.trim()) return decodeURIComponent(q.trim());
  const match = (req.url || "").match(/[?&]recordId=([^&]+)/);
  return match?.[1] ? decodeURIComponent(match[1].trim()) : "";
}

function esc(v: any): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function raw(fields: any, name: string): any {
  return fields?.[name];
}

function displayValue(value: any, fallback = ""): string {
  if (Array.isArray(value)) {
    const mapped = value
      .map((v) => {
        if (typeof v === "string") return v.startsWith("rec") ? "" : v;
        if (v?.name) return v.name;
        if (v?.filename) return v.filename;
        return "";
      })
      .filter(Boolean);
    return mapped.length ? mapped.join(", ") : fallback;
  }

  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value?.name || value?.id || fallback;
  return String(value);
}

function field(fields: any, name: string, fallback = ""): string {
  return displayValue(fields?.[name], fallback);
}

function num(value: any): number | null {
  if (Array.isArray(value)) return value.length ? num(value[0]) : null;
  if (value === null || value === undefined || value === "") return null;

  const cleaned = String(value).replace("%", "").trim();
  const n = Number(cleaned);
  if (Number.isNaN(n)) return null;

  if (n > 1 && n <= 100) return n / 100;
  return n;
}

function pct(value: any): string {
  const n = num(value);
  if (n === null) return "—";
  return `${Math.round(n * 100)}%`;
}

function pctNum(value: any): number {
  const n = num(value);
  if (n === null) return 0;
  return Math.round(n * 100);
}

function count(value: any): string {
  const n = num(value);
  if (n === null) return "0";
  return String(Math.round(n));
}

function scoreColor(value: any): string {
  const n = num(value);
  if (n === null) return "#94a3b8";
  if (n >= 0.8) return "#07923b";
  if (n >= 0.6) return "#2563eb";
  if (n >= 0.4) return "#f97316";
  return "#dc2626";
}

function scoreLabel(value: any): string {
  const n = num(value);
  if (n === null) return "No data";
  if (n >= 0.8) return "Strong";
  if (n >= 0.6) return "Moderate";
  if (n >= 0.4) return "Weak";
  return "Critical";
}

function riskLabel(value: any): string {
  const n = num(value);
  if (n === null) return "No data";
  if (n >= 0.8) return "Low";
  if (n >= 0.6) return "Moderate";
  if (n >= 0.4) return "High";
  return "Critical";
}

async function airtableFetch(url: string) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${AIRTABLE_API_KEY}`,
      "Content-Type": "application/json"
    }
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Airtable fetch failed: ${response.status} ${text}`);
  }

  return JSON.parse(text);
}

async function fetchProgramByRecordId(recordId: string) {
  if (!AIRTABLE_API_KEY) throw new Error("Missing AIRTABLE_API_KEY.");
  if (!AIRTABLE_BASE_ID) throw new Error("Missing AIRTABLE_BASE_ID.");

  const formula = `OR(RECORD_ID()="${recordId}",{Program ID}="${recordId}")`;

  const url =
    `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(
      AIRTABLE_PROGRAMS_TABLE
    )}` +
    `?filterByFormula=${encodeURIComponent(formula)}` +
    `&maxRecords=1`;

  const data = await airtableFetch(url);

  if (!data.records || data.records.length === 0) {
    throw new Error(`No Program found for recordId or Program ID: ${recordId}`);
  }

  return data.records[0];
}

async function fetchActionById(actionRecordId: string) {
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(
    AIRTABLE_ACTIONS_TABLE
  )}/${actionRecordId}`;

  return await airtableFetch(url);
}

async function fetchLinkedActions(programRecord: any) {
  const linked = programRecord.fields?.["Linked Actions"] || [];

  if (!Array.isArray(linked) || linked.length === 0) return [];

  const actions = [];

  for (const actionId of linked) {
    try {
      const actionRecord = await fetchActionById(actionId);
      actions.push(actionRecord);
    } catch (e: any) {
      console.log(`Failed to fetch linked action ${actionId}: ${e.message}`);
    }
  }

  return actions;
}

function point(i: number, total: number, value: number, cx: number, cy: number, r: number) {
  const a = -Math.PI / 2 + (2 * Math.PI * i) / total;
  return { x: cx + r * value * Math.cos(a), y: cy + r * value * Math.sin(a) };
}

function radar(scores: any[]) {
  const cx = 175;
  const cy = 168;
  const r = 100;
  const total = scores.length;
  const avg = scores.reduce((s, x) => s + (num(x.value) ?? 0), 0) / scores.length;

  const rings = [0.25, 0.5, 0.75, 1]
    .map((level) => {
      const ps = scores
        .map((_, i) => point(i, total, level, cx, cy, r))
        .map((p) => `${p.x},${p.y}`)
        .join(" ");
      return `<polygon points="${ps}" fill="none" stroke="#e5e7eb" stroke-width="1"/>`;
    })
    .join("");

  const axes = scores
    .map((_, i) => {
      const p = point(i, total, 1, cx, cy, r);
      return `<line x1="${cx}" y1="${cy}" x2="${p.x}" y2="${p.y}" stroke="#e5e7eb"/>`;
    })
    .join("");

  const poly = scores
    .map((s, i) => point(i, total, num(s.value) ?? 0, cx, cy, r))
    .map((p) => `${p.x},${p.y}`)
    .join(" ");

  const labels = scores
    .map((s, i) => {
      const p = point(i, total, 1.2, cx, cy, r);
      return `<text x="${p.x}" y="${p.y}" text-anchor="middle" dominant-baseline="middle" font-size="12" font-weight="800" fill="#07164a">${s.key}</text>`;
    })
    .join("");

  const dots = scores
    .map((s, i) => {
      const p = point(i, total, num(s.value) ?? 0, cx, cy, r);
      return `<circle cx="${p.x}" cy="${p.y}" r="6" fill="${scoreColor(s.value)}"/>`;
    })
    .join("");

  return `
  <svg viewBox="0 0 350 330" class="radar-svg">
    ${rings}${axes}
    <polygon points="${poly}" fill="rgba(37,99,235,.13)" stroke="#2563eb" stroke-width="3"/>
    ${dots}${labels}
    <circle cx="${cx}" cy="${cy}" r="50" fill="#f8fafc" stroke="#e5e7eb"/>
    <text x="${cx}" y="${cy - 7}" text-anchor="middle" font-size="13" fill="#07164a">Governance</text>
    <text x="${cx}" y="${cy + 23}" text-anchor="middle" font-size="30" font-weight="900" fill="#2563eb">${pct(avg)}</text>
  </svg>`;
}

function gauge(value: any, label: string) {
  const n = num(value) ?? 0;
  const deg = 90 - Math.min(1, Math.max(0, n)) * 180;

  return `
  <div class="gauge-wrap">
    <svg viewBox="0 0 260 145" class="gauge">
      <path d="M40 125 A90 90 0 0 1 220 125" fill="none" stroke="#e5e7eb" stroke-width="18" stroke-linecap="round"/>
      <path d="M40 125 A90 90 0 0 1 105 42" fill="none" stroke="#dc2626" stroke-width="18" stroke-linecap="round"/>
      <path d="M105 42 A90 90 0 0 1 160 42" fill="none" stroke="#fbbf24" stroke-width="18" stroke-linecap="round"/>
      <path d="M160 42 A90 90 0 0 1 220 125" fill="none" stroke="#07923b" stroke-width="18" stroke-linecap="round"/>
      <line x1="130" y1="125" x2="130" y2="52" stroke="#07164a" stroke-width="7" stroke-linecap="round" transform="rotate(${deg} 130 125)"/>
      <circle cx="130" cy="125" r="8" fill="#07164a"/>
    </svg>
    <div class="gauge-label">${esc(label)}</div>
    <div class="gauge-risk">Governance Risk</div>
  </div>`;
}

function healthRows(scores: any[]) {
  return scores
    .map((s) => {
      const n = Math.round((num(s.value) ?? 0) * 100);
      return `
      <div class="health-row">
        <div class="health-name">${s.key} ${esc(s.label)}</div>
        <div class="bar">
          <div class="bar-fill" style="width:${n}%;background:${scoreColor(s.value)}"></div>
        </div>
        <div class="health-pct">${n}%</div>
      </div>`;
    })
    .join("");
}

function splitList(text: string, fallback: string[]) {
  if (!text) return fallback;
  return text
    .split(/\n|;|\|/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 4);
}

function actionComparatorRows(actions: any[]) {
  if (!actions.length) {
    return `<tr><td colspan="5">No linked actions available.</td></tr>`;
  }

  return actions
    .map((record) => {
      const f = record.fields || {};
      const actionId = field(f, "Action ID", record.id);
      const actionName = field(f, "Action Name", "Untitled action");
      const coherence = raw(f, "Overall Coherence");
      const weakest = field(f, "Weakest Component", "Not assessed");
      const triggers = count(raw(f, "Open Triggers"));

      return `
      <tr>
        <td><b>${esc(actionId)}</b><br/><span>${esc(actionName)}</span></td>
        <td><b style="color:${scoreColor(coherence)}">${pct(coherence)}</b></td>
        <td>${esc(riskLabel(coherence))}</td>
        <td>${esc(weakest)}</td>
        <td>${esc(triggers)}</td>
      </tr>`;
    })
    .join("");
}

function urgencyScore(action: any) {
  const f = action.fields || {};
  const overall = num(raw(f, "Overall Coherence")) ?? 0;
  const ociO = num(raw(f, "OCI-O")) ?? overall;
  const triggers = Number(count(raw(f, "Open Triggers"))) || 0;
  const weakest = field(f, "Weakest Component", "");

  let score = 0;
  score += (1 - overall) * 60;
  score += (1 - ociO) * 25;
  score += triggers * 10;

  if (weakest.includes("C4")) score += 8;
  if (weakest.includes("C5")) score += 8;
  if (weakest.includes("C2")) score += 6;

  return score;
}

function urgentActions(actions: any[]) {
  const ranked = [...actions]
    .sort((a, b) => urgencyScore(b) - urgencyScore(a))
    .slice(0, 3);

  if (!ranked.length) {
    return `<div class="urgent-empty">No urgent linked action detected.</div>`;
  }

  return ranked
    .map((record) => {
      const f = record.fields || {};
      const actionId = field(f, "Action ID", record.id);
      const actionName = field(f, "Action Name", "Untitled action");
      const weakest = field(f, "Weakest Component", "Not assessed");
      const coherence = raw(f, "Overall Coherence");
      const level = riskLabel(coherence);

      return `
      <div class="urgent-item">
        <div class="urgent-top">
          <div>
            <div class="urgent-action">${esc(actionId)}</div>
            <div class="urgent-name">${esc(actionName)}</div>
          </div>
          <div class="urgent-level ${level.toLowerCase()}">${esc(level)}</div>
        </div>
        <div class="urgent-reason">
          Weakest layer: <b>${esc(weakest)}</b> · coherence ${esc(pct(coherence))}
        </div>
      </div>`;
    })
    .join("");
}

function buildDashboardData(program: any, actions: any[]) {
  const f = program.fields || {};

  const scores = [
    { key: "C1", label: "Policy Coherence", value: raw(f, "C1 Score") || raw(f, "C1 Continuity Score") },
    { key: "C2", label: "Operational Coordination", value: raw(f, "C2 Score") || raw(f, "C2 Continuity Score") },
    { key: "C3", label: "Resource Continuity", value: raw(f, "C3 Score") || raw(f, "C3 Continuity Score") },
    { key: "C4", label: "Monitoring Reliability", value: raw(f, "C4 Score") || raw(f, "C4 Continuity Score") },
    { key: "C5", label: "Escalation Readiness", value: raw(f, "C5 Score") || raw(f, "C5 Continuity Score") },
    { key: "C6", label: "Auditability Integrity", value: raw(f, "C6 Score") || raw(f, "C6 Continuity Score") }
  ];

  const governanceScore =
    raw(f, "Program Governance Score") ||
    raw(f, "Program Coherence Score") ||
    raw(f, "Overall Coherence Score");

  const continuityScore =
    raw(f, "Program Continuity Score") ||
    raw(f, "Programme Stability Index");

  const synthesis =
    field(f, "Program Governance Summary (AI)") ||
    field(f, "Program Governance Summary") ||
    field(f, "Programme Governance Narrative") ||
    field(f, "Coherence Report") ||
    "No programme governance synthesis available yet.";

  return {
    programId: field(f, "Program ID", program.id),
    programName: field(f, "Program Name", "Programme Governance Dashboard"),
    programType: field(f, "Program Type", "Programme"),
    leadAuthority: field(f, "Lead Authority", "Not specified"),
    supportingAuthorities: field(f, "Supporting Authorities", "Not specified"),
    status: field(f, "Status", "Not specified"),
    governanceStatus:
      field(f, "Program Governance State") ||
      field(f, "Governance Fragility Level") ||
      field(f, "Governance Heat Signal", "Not assessed"),
    governanceScore,
    continuityScore,
    stability: raw(f, "Programme Stability Index"),
    escalationExposure:
      field(f, "Program Escalation Exposure") ||
      field(f, "Escalation Exposure") ||
      field(f, "Escalation Concentration", "0"),
    weakestLayer: field(f, "Weakest Governance Layer", "Not assessed"),
    weakestAction: field(f, "Weakest Action", "Not assessed"),
    criticalActions: field(f, "Critical Actions Count", "0"),
    contradictionSeverity: field(f, "Contradiction Severity", "None"),
    crossActionCoherence:
      field(f, "Cross-Action Coherence") ||
      field(f, "Cross-Action Coherence (AI)", "Not assessed"),
    contradictions:
      field(f, "Cross-Action Contradictions") ||
      field(f, "Cross-Action Contradictions (AI)", "No direct contradictions detected."),
    reviewerPriority: field(f, "Reviewer Priority", "Medium"),
    reviewerAction:
      field(f, "Reviewer Action Required") ||
      field(f, "Recommended Reviewer Focus", "Review programme governance condition."),
    banner:
      field(f, "Governance Dashboard Banner") ||
      "Programme governance condition requires review.",
    recommendedFocus:
      field(f, "Recommended Reviewer Focus", "Validate monitoring, escalation and continuity logic."),
    synthesis,
    policyDiagnosis: field(f, "Policy Diagnosis", "No policy diagnosis available."),
    monitoringDiagnosis: field(f, "Monitoring Diagnosis", "No monitoring diagnosis available."),
    escalationDiagnosis: field(f, "Escalation Diagnosis", "No escalation diagnosis available."),
    auditDiagnosis: field(f, "Audit Trail Diagnosis", "No auditability diagnosis available."),
    scores,
    actions
  };
}

function renderDashboard(data: any): string {
  const risk = riskLabel(data.governanceScore);
  const conditionColor = scoreColor(data.governanceScore);

  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>${esc(data.programId)} Programme Dashboard</title>
<style>
*{box-sizing:border-box}
body{margin:0;background:#f7f9fc;color:#07164a;font-family:Arial,sans-serif;padding:18px}
.page{max-width:1680px;margin:0 auto}
.header{background:#fff;border:1px solid #e8edf5;border-radius:18px;padding:18px 22px;box-shadow:0 8px 24px rgba(15,23,42,.06);margin-bottom:14px}
.topline{display:flex;align-items:center;justify-content:space-between;gap:16px}
.interface{font-size:12px;font-weight:900;color:#2563eb;text-transform:uppercase;margin-bottom:10px}
.title{font-size:28px;font-weight:900;line-height:1.15}
.badge{background:#fff7ed;color:#f97316;padding:7px 12px;border-radius:8px;font-weight:900;font-size:13px}
.meta{display:flex;flex-wrap:wrap;gap:24px;margin-top:12px;font-size:13px}
.banner{background:#fff7e6;border:1px solid #fed7aa;border-radius:12px;padding:12px 16px;margin-bottom:14px;font-size:14px;font-weight:800;color:#9a3412}
.grid-kpi{display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin-bottom:14px}
.card{background:#fff;border:1px solid #e8edf5;border-radius:14px;padding:18px;box-shadow:0 8px 24px rgba(15,23,42,.05)}
.kpi-title{font-weight:900;font-size:13px;margin-bottom:10px;text-align:center}
.kpi-score{font-size:34px;font-weight:900;text-align:center;line-height:1;color:#2563eb}
.kpi-sub{text-align:center;margin-top:8px;font-size:12px;font-weight:800;color:#64748b}
.grid-main{display:grid;grid-template-columns:1fr 1.05fr 1.05fr;gap:14px;margin-bottom:14px}
.section-title{font-size:18px;font-weight:900;margin-bottom:12px}
.radar-svg{height:320px;width:100%;display:block}
.health-row{display:grid;grid-template-columns:190px 1fr 42px;gap:12px;align-items:center;margin:13px 0}
.health-name{font-size:13px;font-weight:900}
.bar{height:8px;background:#e5e7eb;border-radius:99px;overflow:hidden}
.bar-fill{height:8px;border-radius:99px}
.health-pct{text-align:right;font-weight:900;font-size:13px}
.gauge-wrap{text-align:center}
.gauge{width:84%;max-width:330px}
.gauge-label{font-size:25px;color:${conditionColor};font-weight:900;margin-top:-18px}
.gauge-risk{color:${conditionColor};font-weight:800}
.ai-box{background:#f4f0ff;border-radius:14px;padding:14px;margin-top:8px;font-size:13px;line-height:1.55;max-height:170px;overflow:hidden}
.grid-intel{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:14px;margin-bottom:14px}
.grid-lower{display:grid;grid-template-columns:1.1fr 1fr;gap:14px;margin-bottom:14px}
.table{width:100%;border-collapse:collapse;font-size:12px}
.table th{background:#f8fafc;text-align:left;padding:8px;border-bottom:1px solid #e5e7eb}
.table td{padding:8px;border-bottom:1px solid #e5e7eb;vertical-align:top}
.table span{font-size:11px;color:#64748b}
.urgent-item{padding:10px 0;border-bottom:1px solid #fee2e2}
.urgent-item:last-child{border-bottom:none}
.urgent-top{display:flex;justify-content:space-between;gap:10px}
.urgent-action{font-weight:900;color:#991b1b}
.urgent-name{font-size:12px;color:#7f1d1d;margin-top:3px}
.urgent-level{font-size:11px;font-weight:900;color:white;padding:4px 8px;border-radius:8px;background:#f97316}
.urgent-level.critical{background:#dc2626}
.urgent-level.high{background:#f97316}
.urgent-level.moderate{background:#fbbf24;color:#713f12}
.urgent-level.low{background:#16a34a}
.urgent-reason{margin-top:8px;font-size:12px;color:#7f1d1d}
.contradiction{background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:12px;font-size:13px;line-height:1.5}
.priority{background:#eef4ff}
.next{background:#f7efff}
.small{font-size:13px;line-height:1.5}
@media(max-width:1200px){.grid-kpi,.grid-main,.grid-intel,.grid-lower{grid-template-columns:1fr}.health-row{grid-template-columns:1fr}.health-pct{text-align:left}}
</style>
</head>
<body>
<div class="page">

  <div class="header">
    <div class="interface">Programme Reviewer Interface</div>
    <div class="topline">
      <div>
        <div class="title">${esc(data.programName)}</div>
        <div class="meta">
          <div><b>Program ID:</b> ${esc(data.programId)}</div>
          <div><b>Lead Authority:</b> ${esc(data.leadAuthority)}</div>
          <div><b>Status:</b> ${esc(data.status)}</div>
          <div><b>Type:</b> ${esc(data.programType)}</div>
        </div>
      </div>
      <div class="badge">${esc(data.governanceStatus)}</div>
    </div>
  </div>

  <div class="grid-kpi">
    <div class="card"><div class="kpi-title">Governance Condition</div><div class="kpi-score" style="color:${scoreColor(data.governanceScore)}">${pct(data.governanceScore)}</div><div class="kpi-sub">${esc(scoreLabel(data.governanceScore))}</div></div>
    <div class="card"><div class="kpi-title">Continuity Posture</div><div class="kpi-score" style="color:${scoreColor(data.continuityScore)}">${pct(data.continuityScore)}</div><div class="kpi-sub">Programme continuity</div></div>
    <div class="card"><div class="kpi-title">Stability Index</div><div class="kpi-score" style="color:${scoreColor(data.stability)}">${pct(data.stability)}</div><div class="kpi-sub">Cross-action stability</div></div>
    <div class="card"><div class="kpi-title">Weakest Layer</div><div class="kpi-score" style="font-size:22px;color:#dc2626">${esc(data.weakestLayer)}</div><div class="kpi-sub">Primary fragility</div></div>
    <div class="card"><div class="kpi-title">Critical Actions</div><div class="kpi-score" style="color:#f97316">${esc(data.criticalActions)}</div><div class="kpi-sub">Below threshold</div></div>
    <div class="card"><div class="kpi-title">Review Priority</div><div class="kpi-score" style="font-size:24px;color:#f97316">${esc(data.reviewerPriority)}</div><div class="kpi-sub">Reviewer queue</div></div>
  </div>

  <div class="banner">● ${esc(data.banner)}</div>

  <div class="grid-main">
    <div class="card"><div class="section-title">Governance Condition (C1–C6)</div>${radar(data.scores)}</div>
    <div class="card"><div class="section-title">Governance Health Summary</div>${healthRows(data.scores)}</div>
    <div class="card">
      <div class="section-title">Governance Risk Indicator</div>
      ${gauge(data.governanceScore, risk)}
      <div class="ai-box"><b>AI Governance Synthesis</b><br/>${esc(data.synthesis)}</div>
    </div>
  </div>

  <div class="grid-intel">
    <div class="card">
      <div class="section-title">Most Urgent Actions</div>
      ${urgentActions(data.actions)}
    </div>

    <div class="card">
      <div class="section-title">Governance Contradictions</div>
      <div class="contradiction">
        <b>Severity:</b> ${esc(data.contradictionSeverity)}<br/><br/>
        ${esc(data.contradictions)}
      </div>
    </div>

    <div class="card priority">
      <div class="section-title">Reviewer Priority Action</div>
      <div class="small">${esc(data.reviewerAction)}</div>
      <br/>
      <div class="section-title">Recommended Focus</div>
      <div class="small">${esc(data.recommendedFocus)}</div>
    </div>
  </div>

  <div class="grid-lower">
    <div class="card">
      <div class="section-title">Action Coherence Comparator</div>
      <table class="table">
        <thead>
          <tr>
            <th>Action</th>
            <th>Coherence</th>
            <th>Risk</th>
            <th>Weakest Layer</th>
            <th>Triggers</th>
          </tr>
        </thead>
        <tbody>
          ${actionComparatorRows(data.actions)}
        </tbody>
      </table>
    </div>

    <div class="card">
      <div class="section-title">Programme Diagnosis Snapshot</div>
      <div class="small"><b>Policy:</b> ${esc(data.policyDiagnosis)}</div><br/>
      <div class="small"><b>Monitoring:</b> ${esc(data.monitoringDiagnosis)}</div><br/>
      <div class="small"><b>Escalation:</b> ${esc(data.escalationDiagnosis)}</div><br/>
      <div class="small"><b>Auditability:</b> ${esc(data.auditDiagnosis)}</div>
    </div>
  </div>

</div>
</body>
</html>`;
}

app.get("/", (_req, res) => res.redirect("/api"));

app.get("/api", async (req, res) => {
  try {
    const recordId = getRecordId(req);

    if (!recordId) {
      return res.type("html").send(
        renderDashboard({
          programId: "Demo",
          programName: "Missing recordId",
          programType: "Demo",
          leadAuthority: "Add ?recordId=recXXXXXXXX to the URL",
          supportingAuthorities: "Demo",
          status: "Demo",
          governanceStatus: "Demo",
          governanceScore: null,
          continuityScore: null,
          stability: null,
          escalationExposure: "0",
          weakestLayer: "No data",
          weakestAction: "No data",
          criticalActions: "0",
          contradictionSeverity: "None",
          contradictions: "No contradictions detected.",
          crossActionCoherence: "No data",
          reviewerPriority: "No data",
          reviewerAction: "Add a valid Program recordId.",
          banner: "This endpoint is working. Add a valid recordId.",
          recommendedFocus: "Connect from the Program Dashboard URL field.",
          synthesis: "No programme selected.",
          policyDiagnosis: "No data.",
          monitoringDiagnosis: "No data.",
          escalationDiagnosis: "No data.",
          auditDiagnosis: "No data.",
          scores: [
            { key: "C1", label: "Policy Coherence", value: 0 },
            { key: "C2", label: "Operational Coordination", value: 0 },
            { key: "C3", label: "Resource Continuity", value: 0 },
            { key: "C4", label: "Monitoring Reliability", value: 0 },
            { key: "C5", label: "Escalation Readiness", value: 0 },
            { key: "C6", label: "Auditability Integrity", value: 0 }
          ],
          actions: []
        })
      );
    }

    const program = await fetchProgramByRecordId(recordId);
    const actions = await fetchLinkedActions(program);
    const data = buildDashboardData(program, actions);

    return res.type("html").send(renderDashboard(data));
  } catch (error: any) {
    return res.status(500).json({
      error: error.message || String(error)
    });
  }
});

app.post("/api", (req, res) => {
  res.type("html").send(renderDashboard(req.body || {}));
});

export default app;

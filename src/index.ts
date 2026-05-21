import express from "express";

const app = express();
app.use(express.json({ limit: "2mb" }));

const AIRTABLE_API_KEY = process.env.AIRTABLE || process.env.AIRTABLE_API_KEY || "";
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID || "app1ulAFNbDuizG4n";
const AIRTABLE_PROGRAMS_TABLE = process.env.AIRTABLE_PROGRAMS_TABLE || "tblb080LKdZLFit2x";

function esc(v: any): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function getRecordId(req: any): string {
  const q = req.query?.recordId;
  if (typeof q === "string" && q.trim()) return decodeURIComponent(q.trim());
  const match = (req.url || "").match(/[?&]recordId=([^&]+)/);
  return match?.[1] ? decodeURIComponent(match[1].trim()) : "";
}

function display(v: any, fallback = "—"): string {
  if (Array.isArray(v)) return v.map(x => x?.name || x).filter(Boolean).join(", ") || fallback;
  if (v === undefined || v === null || v === "") return fallback;
  if (typeof v === "object") return v.name || v.id || fallback;
  return String(v);
}

function raw(fields: any, names: string | string[]) {
  const arr = Array.isArray(names) ? names : [names];
  for (const name of arr) {
    const v = fields?.[name];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
}

function pick(fields: any, names: string | string[], fallback = "—") {
  return display(raw(fields, names), fallback);
}

function num(v: any): number | null {
  if (Array.isArray(v)) return v.length ? num(v[0]) : null;
  if (v === undefined || v === null || v === "") return null;
  const n = Number(String(v).replace("%", "").trim());
  if (Number.isNaN(n)) return null;
  return n > 1 && n <= 100 ? n / 100 : n;
}

function pct(v: any): string {
  const n = num(v);
  return n === null ? "—" : `${Math.round(n * 100)}%`;
}

function color(v: any): string {
  const n = num(v);
  if (n === null) return "#94a3b8";
  if (n >= 0.8) return "#07923b";
  if (n >= 0.6) return "#2563eb";
  if (n >= 0.4) return "#f97316";
  return "#dc2626";
}

function label(v: any): string {
  const n = num(v);
  if (n === null) return "No data";
  if (n >= 0.8) return "Strong";
  if (n >= 0.6) return "Partial";
  if (n >= 0.4) return "Fragile";
  return "Critical";
}

async function airtableFetch(url: string) {
  if (!AIRTABLE_API_KEY) throw new Error("Missing AIRTABLE API key");

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${AIRTABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
  });

  const text = await response.text();
  if (!response.ok) throw new Error(`Airtable ${response.status}: ${text}`);
  return JSON.parse(text);
}

async function fetchProgram(recordId: string) {
  const formula = `OR(RECORD_ID()="${recordId}",{Program ID}="${recordId}")`;

  const rawParams = new URLSearchParams({
    filterByFormula: formula,
    maxRecords: "1",
  });

  const stringParams = new URLSearchParams({
    filterByFormula: formula,
    maxRecords: "1",
    cellFormat: "string",
    timeZone: "Europe/Paris",
    userLocale: "en-us",
  });

  const base = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_PROGRAMS_TABLE)}`;

  const [rawData, stringData] = await Promise.all([
    airtableFetch(`${base}?${rawParams.toString()}`),
    airtableFetch(`${base}?${stringParams.toString()}`),
  ]);

  if (!rawData.records?.length) throw new Error(`No Program found for ${recordId}`);

  return {
    raw: rawData.records[0].fields || {},
    str: stringData.records?.[0]?.fields || rawData.records[0].fields || {},
  };
}

function bar(labelText: string, value: any, sub: string) {
  const width = Math.round((num(value) ?? 0) * 100);
  return `
    <div class="bar-row">
      <div>
        <div class="bar-label">${esc(labelText)}</div>
        <div class="bar-sub">${esc(sub)}</div>
      </div>
      <div class="bar-track">
        <div class="bar-fill" style="width:${width}%;background:${color(value)}"></div>
      </div>
      <div class="bar-pct">${pct(value)}</div>
    </div>
  `;
}

function kpi(title: string, value: any, sub: string) {
  return `
    <div class="card kpi">
      <div class="kpi-title">${esc(title)}</div>
      <div class="kpi-score" style="color:${color(value)}">${pct(value)}</div>
      <div class="kpi-sub">${esc(sub)}</div>
    </div>
  `;
}

function build(pair: any) {
  const rawFields = pair?.raw || {};
  const strFields = pair?.str || {};
  const f = { ...rawFields, ...strFields };

  const finalCoherence = raw(rawFields, [
    "Final Programme Coherence Score",
    "Program Governance Score",
    "Program Coherence Score",
    "Overall Coherence Score",
  ]);

  const finalOciD = raw(rawFields, [
    "Final Programme OCI-D Score",
    "Programme Intrinsic OCI-D",
    "OCI-D",
  ]);

  const finalOciO = raw(rawFields, [
    "Final Programme OCI-O Score",
    "Programme Intrinsic OCI-O",
    "OCI-O",
  ]);

  const actionSignal = raw(rawFields, [
    "Action Aggregation Coherence Score",
    "Overall Coherence Score",
  ]);

  const c1 = raw(rawFields, ["Programme C1 Claim-Evidence Score", "C1 Score"]);
  const c2 = raw(rawFields, ["Programme C2 Claim-Evidence Score", "C2 Score"]);
  const c3 = raw(rawFields, ["Programme C3 Claim-Evidence Score", "C3 Score"]);
  const c4 = raw(rawFields, ["Programme C4 Claim-Evidence Score", "C4 Score"]);
  const c5 = raw(rawFields, ["Programme C5 Claim-Evidence Score", "C5 Score"]);
  const c6 = raw(rawFields, ["Programme C6 Claim-Evidence Score", "C6 Score"]);

  return {
    name: pick(f, "Program Name", "Programme Dashboard"),
    id: pick(f, "Program ID", "—"),
    lead: pick(f, "Lead Authority", "Not specified"),
    support: pick(f, "Supporting Authorities", "Not specified"),
    coordination: pick(f, "Coordination Owner", "Not specified"),
    escalationAuthority: pick(f, "Escalation Authority", "Not specified"),
    validationAuthority: pick(f, "Validation Authority", "Not specified"),
    status: pick(f, "Status", "—"),
    reviewStatus: pick(f, "Program Review Status", "Pending validation"),
    reviewPriority: pick(f, "Reviewer Priority", "Medium"),

    finalCoherence,
    finalOciD,
    finalOciO,
    actionSignal,
    c1,
    c2,
    c3,
    c4,
    c5,
    c6,

    weakestLayer: pick(f, "Weakest Governance Layer", "Not assessed"),
    weakestAction: pick(f, "Weakest Action", "Not assessed"),
    criticalActions: pick(f, "Critical Actions Count", "0"),

    narrative: pick(
      f,
      ["Program Governance Summary (AI)", "Program Governance Summary", "Programme OCI-D Rationale"],
      "No programme governance narrative available."
    ),

    resourceDiagnosis: pick(f, "Resource Diagnosis", "Programme resource base requires review."),
    monitoringDiagnosis: pick(f, "Monitoring Diagnosis", "Programme monitoring reliability requires review."),
    escalationDiagnosis: pick(f, "Escalation Diagnosis", "Programme escalation pathways require review."),
    auditDiagnosis: pick(f, "Audit Trail Diagnosis", "Programme documentation requires stronger evidence linkage."),
  };
}

function html(d: any) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>${esc(d.name)}</title>
<style>
*{box-sizing:border-box}
body{margin:0;background:#f3f6fb;color:#06164a;font-family:Arial,sans-serif;padding:18px}
.page{max-width:1550px;margin:0 auto}
.header,.card{background:#fff;border:1px solid #e8edf5;border-radius:18px;padding:18px;box-shadow:0 8px 24px rgba(15,23,42,.05)}
.header{margin-bottom:14px}
.kicker{font-size:12px;font-weight:900;text-transform:uppercase;color:#2563eb;margin-bottom:8px}
.top{display:flex;justify-content:space-between;gap:18px;align-items:center}
.title{font-size:30px;font-weight:900;line-height:1.15}
.meta{display:flex;flex-wrap:wrap;gap:18px;margin-top:10px;font-size:13px}
.badge{background:#eef4ff;color:#2563eb;border-radius:14px;padding:16px 20px;font-size:20px;font-weight:900}
.grid6{display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin-bottom:14px}
.grid3{display:grid;grid-template-columns:1fr 1.15fr 1fr;gap:14px;margin-bottom:14px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.kpi{text-align:center;min-height:130px}
.kpi-title{font-size:15px;margin-bottom:10px}
.kpi-score{font-size:33px;font-weight:900;line-height:1}
.kpi-sub{font-size:12px;font-weight:800;color:#64748b;margin-top:10px}
.section{font-size:19px;font-weight:900;margin-bottom:14px}
.row{display:grid;grid-template-columns:170px 1fr;gap:12px;margin:12px 0;font-size:14px}
.row b{font-weight:900}
.bar-row{display:grid;grid-template-columns:220px 1fr 48px;gap:12px;align-items:center;margin:13px 0}
.bar-label{font-size:15px;font-weight:900}
.bar-sub{font-size:11px;color:#64748b;margin-top:2px}
.bar-track{height:10px;background:#e5e7eb;border-radius:99px;overflow:hidden}
.bar-fill{height:10px;border-radius:99px}
.bar-pct{font-size:14px;font-weight:900;text-align:right}
.warn{background:#fff7ed;border-color:#fed7aa}
.ai{background:#f4f0ff;border-radius:14px;padding:14px;font-size:14px;line-height:1.6}
.small{font-size:14px;line-height:1.6}
.pill{display:inline-block;padding:6px 10px;border-radius:9px;font-size:12px;font-weight:900;background:#eef4ff;color:#2563eb}
@media(max-width:1100px){.grid6,.grid3,.grid2{grid-template-columns:1fr}.top{display:block}.badge{margin-top:12px}.bar-row{grid-template-columns:1fr}}
</style>
</head>
<body>
<div class="page">

<div class="header">
  <div class="kicker">Programme Execution & Institutional Coordination Interface</div>
  <div class="top">
    <div>
      <div class="title">${esc(d.name)}</div>
      <div class="meta">
        <div><b>Program ID:</b> ${esc(d.id)}</div>
        <div><b>Lead Authority:</b> ${esc(d.lead)}</div>
        <div><b>Status:</b> ${esc(d.status)}</div>
        <div><b>Validation:</b> ${esc(d.reviewStatus)}</div>
      </div>
    </div>
    <div class="badge">${esc(d.reviewPriority)} Review Priority</div>
  </div>
</div>

<div class="grid6">
  ${kpi("Execution Condition", d.finalCoherence, label(d.finalCoherence))}
  ${kpi("Continuity Posture", d.finalOciO, "Final OCI-O")}
  ${kpi("Coordination Health", d.actionSignal, "Action signal")}
  ${kpi("Monitoring Reliability", d.c4, "C4 visibility")}
  ${kpi("Escalation Readiness", d.c5, "C5 response chain")}
  ${kpi("Critical Actions", d.criticalActions, "Below threshold")}
</div>

<div class="grid3">
  <div class="card">
    <div class="section">Institutional Coordination Map</div>
    <div class="row"><b>Lead Authority</b><div>${esc(d.lead)}</div></div>
    <div class="row"><b>Supporting Authorities</b><div>${esc(d.support)}</div></div>
    <div class="row"><b>Coordination Owner</b><div>${esc(d.coordination)}</div></div>
    <div class="row"><b>Escalation Authority</b><div>${esc(d.escalationAuthority)}</div></div>
    <div class="row"><b>Validation Authority</b><div>${esc(d.validationAuthority)}</div></div>
  </div>

  <div class="card">
    <div class="section">Operational Dependency Matrix</div>
    ${bar("Resource continuity", d.c3, "C3 funding and resource feasibility")}
    ${bar("Monitoring reliability", d.c4, "C4 data continuity")}
    ${bar("Escalation readiness", d.c5, "C5 trigger and response integrity")}
    ${bar("Auditability integrity", d.c6, "C6 traceability chain")}
    ${bar("Coordination health", d.actionSignal, "Inherited action coherence")}
  </div>

  <div class="card warn">
    <div class="section">Programme Trigger Monitor</div>
    <div class="small"><b>Weakest Layer:</b> ${esc(d.weakestLayer)}</div>
    <br/>
    <div class="small"><b>Weakest Action:</b> ${esc(d.weakestAction)}</div>
    <br/>
    <span class="pill">Renderer active</span>
  </div>
</div>

<div class="grid2">
  <div class="card">
    <div class="section">Execution Diagnostics</div>
    <div class="small"><b>Resource:</b> ${esc(d.resourceDiagnosis)}</div><br/>
    <div class="small"><b>Monitoring:</b> ${esc(d.monitoringDiagnosis)}</div><br/>
    <div class="small"><b>Escalation:</b> ${esc(d.escalationDiagnosis)}</div><br/>
    <div class="small"><b>Audit:</b> ${esc(d.auditDiagnosis)}</div>
  </div>

  <div class="card">
    <div class="section">Programme Operational Narrative</div>
    <div class="ai">${esc(d.narrative)}</div>
  </div>
</div>

</div>
</body>
</html>`;
}

app.get("/", (_req, res) => res.redirect("/api"));

app.get("/api", async (req, res) => {
  try {
    const id = getRecordId(req);
    const pair = id ? await fetchProgram(id) : { raw: {}, str: {} };
    res.type("html").send(html(build(pair)));
  } catch (e: any) {
    res.status(500).type("html").send(`<pre>${esc(e.message || String(e))}</pre>`);
  }
});

export default app;

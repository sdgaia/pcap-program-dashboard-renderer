// Restored Programme Execution Dashboard
// Updated to use Final Programme Coherence / OCI-D / OCI-O fields

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

function display(v: any, fallback = "—") {
  if (Array.isArray(v)) return v.join(", ") || fallback;
  if (v === undefined || v === null || v === "") return fallback;
  return String(v);
}

function raw(fields: any, names: string | string[]) {
  const arr = Array.isArray(names) ? names : [names];
  for (const n of arr) {
    const v = fields?.[n];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
}

function pick(fields: any, names: string | string[], fallback = "—") {
  const arr = Array.isArray(names) ? names : [names];
  for (const n of arr) {
    const v = display(fields?.[n], "");
    if (v) return v;
  }
  return fallback;
}

function num(v: any): number | null {
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

async function airtableFetch(url: string) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${AIRTABLE_API_KEY}`,
      "Content-Type": "application/json"
    }
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Airtable ${response.status}: ${text}`);
  }

  return JSON.parse(text);
}

async function fetchProgram(recordId: string) {
  const formula = `OR(RECORD_ID()="${recordId}",{Program ID}="${recordId}")`;

  const params = new URLSearchParams({
    filterByFormula: formula,
    maxRecords: "1",
    cellFormat: "string",
    timeZone: "Europe/Paris",
    userLocale: "en-us"
  });

  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_PROGRAMS_TABLE)}?${params.toString()}`;

  const data = await airtableFetch(url);

  if (!data.records?.length) {
    throw new Error(`No Program found for ${recordId}`);
  }

  return data.records[0].fields || {};
}

function bar(label: string, value: any) {
  const width = Math.round((num(value) ?? 0) * 100);

  return `
    <div class="bar-row">
      <div class="bar-label">${esc(label)}</div>
      <div class="bar-track">
        <div class="bar-fill" style="width:${width}%;background:${color(value)}"></div>
      </div>
      <div class="bar-pct">${pct(value)}</div>
    </div>
  `;
}

function build(fields: any) {
  return {
    name: pick(fields, "Program Name", "Programme Dashboard"),
    id: pick(fields, "Program ID", "—"),
    lead: pick(fields, "Lead Authority", "Not specified"),
    status: pick(fields, "Status", "—"),

    governanceCondition: raw(fields, ["Final Programme Coherence Score"]),
    continuityPosture: raw(fields, ["Final Programme OCI-O Score"]),
    stabilityIndex: raw(fields, ["Final Programme OCI-D Score"]),

    weakestLayer: pick(fields, "Weakest Governance Layer", "Not assessed"),
    criticalActions: pick(fields, "Critical Actions Count", "0"),
    reviewPriority: pick(fields, "Reviewer Priority", "Medium"),

    c1: raw(fields, ["Programme C1 Claim-Evidence Score"]),
    c2: raw(fields, ["Programme C2 Claim-Evidence Score"]),
    c3: raw(fields, ["Programme C3 Claim-Evidence Score"]),
    c4: raw(fields, ["Programme C4 Claim-Evidence Score"]),
    c5: raw(fields, ["Programme C5 Claim-Evidence Score"]),
    c6: raw(fields, ["Programme C6 Claim-Evidence Score"]),

    narrative: pick(fields, ["Program Governance Summary (AI)", "Programme OCI-D Rationale"], "No governance narrative available."),

    resourceDiagnosis: pick(fields, "Resource Diagnosis", "Programme resource base is weak"),
    monitoringDiagnosis: pick(fields, "Monitoring Diagnosis", "Programme lacks a reliable monitoring system"),
    escalationDiagnosis: pick(fields, "Escalation Diagnosis", "Programme corrective pathways are weak"),
    auditDiagnosis: pick(fields, "Audit Trail Diagnosis", "Programme documentation requires stronger evidence linkage")
  };
}

function html(d: any) {
  return `<!doctype html><html><head><meta charset="utf-8"/><title>${esc(d.name)}</title></head><body><h1>${esc(d.name)}</h1></body></html>`;
}

app.get("/", (_req, res) => res.redirect("/api"));

app.get("/api", async (req, res) => {
  try {
    const id = getRecordId(req);
    const fields = id ? await fetchProgram(id) : {};
    res.type("html").send(html(build(fields)));
  } catch (e: any) {
    res.status(500).send(`<pre>${esc(e.message || String(e))}</pre>`);
  }
});

export default app;

import express from "express";

const app = express();
app.use(express.json({ limit: "2mb" }));

const AIRTABLE_API_KEY = process.env.AIRTABLE || process.env.AIRTABLE_API_KEY || "";
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID || "app1ulAFNbDuizG4n";
const AIRTABLE_PROGRAMS_TABLE = process.env.AIRTABLE_PROGRAMS_TABLE || "tblb080LKdZLFit2x";

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

function display(v: any, fallback = "—"): string {
  if (Array.isArray(v)) return v.map(x => x?.name || x).filter(Boolean).join(", ") || fallback;
  if (v === undefined || v === null || v === "") return fallback;
  if (typeof v === "object") return v.name || v.id || fallback;
  return String(v);
}

function pick(fields: any, names: string[], fallback = "—"): string {
  for (const name of names) {
    const value = display(fields?.[name], "");
    if (value) return value;
  }
  return fallback;
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
  if (n >= 0.85) return "#059669";
  if (n >= 0.70) return "#2563eb";
  if (n >= 0.50) return "#f97316";
  return "#dc2626";
}

function label(v: any): string {
  const n = num(v);
  if (n === null) return "Not assessed";
  if (n >= 0.85) return "High";
  if (n >= 0.70) return "Moderate";
  if (n >= 0.50) return "Fragile";
  return "Critical";
}

async function airtableFetch(url: string) {
  if (!AIRTABLE_API_KEY) throw new Error("Missing AIRTABLE or AIRTABLE_API_KEY environment variable.");
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}`, "Content-Type": "application/json" }
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Airtable ${response.status}: ${text}`);
  return JSON.parse(text);
}

async function fetchProgram(recordId: string) {
  const formula = `OR(RECORD_ID()="${recordId}",{Program ID}="${recordId}")`;
  const rawParams = new URLSearchParams({ filterByFormula: formula, maxRecords: "1" });
  const stringParams = new URLSearchParams({ filterByFormula: formula, maxRecords: "1", cellFormat: "string", timeZone: "Europe/Paris", userLocale: "en-us" });

  const base = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_PROGRAMS_TABLE)}`;
  const [raw, str] = await Promise.all([
    airtableFetch(`${base}?${rawParams.toString()}`),
    airtableFetch(`${base}?${stringParams.toString()}`)
  ]);

  if (!raw.records?.length) throw new Error(`No Program found for ${recordId}`);
  return { raw: raw.records[0].fields || {}, str: str.records?.[0]?.fields || raw.records[0].fields || {}, id: raw.records[0].id };
}

function gauge(title: string, value: any, sub: string) {
  const n = num(value) ?? 0;
  return `<div class="card gauge-card"><div class="gauge-title">${esc(title)}</div><div class="gauge" style="--p:${Math.round(n * 360)}deg;--c:${color(value)}"><div><b>${pct(value)}</b><span>${esc(label(value))}</span></div></div><div class="sub">${esc(sub)}</div></div>`;
}

function heat(title: string, value: any) {
  const width = Math.max(4, Math.round((num(value) ?? 0) * 100));
  return `<div class="heat"><span>${esc(title)}</span><i style="width:${width}%;background:${color(value)}"></i><b>${pct(value)}</b></div>`;
}

function stat(title: string, value: any, sub = "") {
  return `<div class="stat"><div><span>${esc(title)}</span>${sub ? `<small>${esc(sub)}</small>` : ""}</div><b>${esc(display(value))}</b></div>`;
}

function buildData(pair: any, msg = "") {
  const r = pair?.raw || {};
  const s = pair?.str || {};
  return {
    id: pick(s, ["Program ID"], pair?.id || "PLACEHOLDER"),
    name: pick(s, ["Program Name"], "Programme Coherence Dashboard"),
    lead: pick(s, ["Lead Authority", "Lead Authority Name"], "—"),
    support: pick(s, ["Supporting Authorities", "Supporting Authorities Names"], "—"),
    status: pick(s, ["Status"], "—"),
    validation: pick(s, ["Program Review Status"], "Pending review"),
    badge: pick(s, ["Final Programme Coherence Status", "Program Governance State"], label(r["Final Programme Coherence Score"])),
    final: r["Final Programme Coherence Score"] ?? r["Overall Coherence Score"],
    d: r["Final Programme OCI-D Score"],
    o: r["Final Programme OCI-O Score"],
    action: r["Action Aggregation Coherence Score"] ?? r["Overall Coherence Score"],
    supportRate: r["Claim Evidence Support Rate"],
    claims: r["Programme Claim Count"],
    evidence: r["Evidence-Linked Claim Count"],
    weak: r["Weak Claims Count"],
    c1: r["Programme C1 Claim-Evidence Score"],
    c2: r["Programme C2 Claim-Evidence Score"],
    c3: r["Programme C3 Claim-Evidence Score"],
    c4: r["Programme C4 Claim-Evidence Score"],
    c5: r["Programme C5 Claim-Evidence Score"],
    c6: r["Programme C6 Claim-Evidence Score"],
    weakest: pick(s, ["Weakest Governance Layer", "Weakest Component"], "—"),
    narrative: msg || pick(s, ["Program Governance Summary (AI)", "Program Governance Summary", "Programme OCI-D Rationale"], "Programme coherence dashboard rendered successfully.")
  };
}

function renderDashboard(d: any): string {
  return `<!doctype html><html><head><meta charset="utf-8"/><title>${esc(d.name)}</title><style>
*{box-sizing:border-box}body{margin:0;background:#f3f6fb;color:#06164a;font-family:Arial,sans-serif;padding:18px}.page{max-width:1500px;margin:0 auto}.head,.card{background:#fff;border:1px solid #e8edf5;border-radius:18px;padding:18px;box-shadow:0 8px 24px rgba(15,23,42,.05)}.head{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-bottom:14px}.kicker{font-size:12px;font-weight:900;color:#2563eb;text-transform:uppercase}.title{font-size:30px;font-weight:900;margin:8px 0}.meta{display:flex;gap:18px;flex-wrap:wrap;font-size:13px}.badge{background:#eef4ff;color:#2563eb;border-radius:14px;padding:16px 20px;font-size:20px;font-weight:900}.grid5{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:14px}.grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px}.gauge-card{text-align:center;min-height:185px}.gauge-title{font-size:15px;font-weight:900}.gauge{width:112px;height:112px;border-radius:50%;margin:12px auto;background:conic-gradient(var(--c) var(--p),#e5e7eb 0deg);display:grid;place-items:center}.gauge div{width:78px;height:78px;border-radius:50%;background:#fff;display:grid;place-items:center;align-content:center}.gauge b{font-size:25px}.gauge span,.sub,small{font-size:11px;color:#64748b;font-weight:900}.section{font-size:19px;font-weight:900;margin-bottom:14px}.heat{display:grid;grid-template-columns:150px 1fr 48px;gap:12px;align-items:center;margin:13px 0;font-weight:900}.heat i{height:17px;border-radius:99px}.stat{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #e5e7eb;padding:12px 0}.stat:last-child{border-bottom:none}.stat span{font-weight:900}.stat small{display:block;margin-top:2px}.stat b{font-size:22px}.risk{background:#fff7ed;border-color:#fed7aa}.risk strong{font-size:23px;display:block;margin-bottom:12px}.narr{background:#f4f0ff;border-radius:14px;padding:14px;line-height:1.55;font-size:14px}@media(max-width:1100px){.grid5,.grid3{grid-template-columns:1fr}.head{display:block}.badge{margin-top:12px}.heat{grid-template-columns:1fr}}
</style></head><body><div class="page"><div class="head"><div><div class="kicker">Programme OCI-D / OCI-O Dashboard</div><div class="title">${esc(d.name)}</div><div class="meta"><div><b>Program ID:</b> ${esc(d.id)}</div><div><b>Lead:</b> ${esc(d.lead)}</div><div><b>Status:</b> ${esc(d.status)}</div><div><b>Validation:</b> ${esc(d.validation)}</div></div></div><div class="badge">${esc(d.badge)}</div></div>
<div class="grid5">${gauge("Final Coherence", d.final, "Programme")}${gauge("OCI-D", d.d, "Design")}${gauge("OCI-O", d.o, "Operational")}${gauge("Action Signal", d.action, "Inherited")}${gauge("Evidence", d.supportRate, "Claim support")}</div>
<div class="grid3"><div class="card"><div class="section">C1–C6 Heatmap</div>${heat("C1 Policy", d.c1)}${heat("C2 Operational", d.c2)}${heat("C3 Resources", d.c3)}${heat("C4 Monitoring", d.c4)}${heat("C5 Escalation", d.c5)}${heat("C6 Traceability", d.c6)}</div><div class="card"><div class="section">Claim Control</div>${stat("Claims", d.claims, "Extracted")}${stat("Evidence-linked", d.evidence, "Supported")}${stat("Weak claims", d.weak, "Reviewer focus")}${stat("Support rate", pct(d.supportRate), "Evidence coverage")}</div><div class="card risk"><div class="section">Critical Risk</div><strong>${esc(d.weakest)}</strong><div class="narr">${esc(d.narrative)}</div></div></div></div></body></html>`;
}

app.get("/", async (req, res) => {
  try {
    const recordId = getRecordId(req);
    const pair = recordId ? await fetchProgram(recordId) : null;
    return res.type("html").send(renderDashboard(buildData(pair)));
  } catch (error: any) {
    return res.type("html").send(renderDashboard(buildData(null, `Runtime error captured without crashing: ${error.message || String(error)}`)));
  }
});

app.get("/api", async (req, res) => {
  try {
    const recordId = getRecordId(req);
    const pair = recordId ? await fetchProgram(recordId) : null;
    return res.type("html").send(renderDashboard(buildData(pair)));
  } catch (error: any) {
    return res.type("html").send(renderDashboard(buildData(null, `Runtime error captured without crashing: ${error.message || String(error)}`)));
  }
});

app.post("/api", (req, res) => {
  res.type("html").send(renderDashboard(req.body || {}));
});

export default app;

// เคสที่เคยแก้: นำเข้าจากไฟล์ Excel ที่ Export จากระบบรับแจ้งเคส แล้วค้นหาแบบเรียงตามความคล้าย
const crypto = require("crypto");
const ExcelJS = require("exceljs");
const { db } = require("./db");

db.exec(`
CREATE TABLE IF NOT EXISTS cases (
  id TEXT PRIMARY KEY,
  case_no TEXT,
  date TEXT,
  project TEXT,
  source TEXT,
  unit TEXT,
  province TEXT,
  detail TEXT NOT NULL,
  cause TEXT NOT NULL DEFAULT '',
  solution TEXT NOT NULL,
  solver TEXT,
  duration TEXT,
  type TEXT,
  imported_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cases_date ON cases(date);
`);
const loc = require("./locations"); // adds the place columns to the cases table

/* ---------- Thai text normalisation (shared with the page) ---------- */
const norm = require("./public/norm.js");
const core = require("./public/search-core.js");
const { FILLER } = core;

/* ---------- cleaning on import ---------- */
const PRIVATE = [
  [/anydesk\s*[:：]?\s*[\d\s-]{6,}/gi, "AnyDesk [ลบแล้ว]"],
  [/U[0-9a-f]{32}/g, "[ลบแล้ว]"],
  [/(?<!\d)0[0-9][-\s]?\d{3}[-\s]?\d{3,4}(?!\d)/g, "[เบอร์ลบแล้ว]"],
  [/(?<![\d=])\d{9,10}(?!\d)/g, "[ลบแล้ว]"],
];
function scrub(s) {
  let t = String(s ?? "").trim();
  let hit = false;
  for (const [re, to] of PRIVATE) t = t.replace(re, () => ((hit = true), to));
  return { text: t, hit };
}
// a "solution" that only says the user can now use it, or that nobody could be reached
function isUseless(sol) {
  const t = String(sol || "").trim().replace(/เเ/g, "แ");
  if (t.length < 8) return true;
  if (/ไม่สามารถติดต่อ|ติดต่อไม่ได้|ไม่ใช่เคส|ยกเลิกเคส|ไม่ตอบกลับ|ไม่สะดวก|แจ้งเคสเข้ามาใหม่|แจ้งเข้ามาใหม่/.test(t) && t.length < 60) return true;
  return t.replace(FILLER, "").length < 3;
}
// the fix text says little beyond "it works now": still kept, but ranked lower in search
// a problem text that is only a date ("8 ต.ค. 69") gives nothing to search on
const isDateOnly = (s) => /^[\d\s./-]*(ม\.?ค|ก\.?พ|มี\.?ค|เม\.?ย|พ\.?ค|มิ\.?ย|ก\.?ค|ส\.?ค|ก\.?ย|ต\.?ค|พ\.?ย|ธ\.?ค)?\.?[\d\s./-]*$/.test(String(s).trim());
function toISODate(v) {
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
  const t = String(v || "").trim();
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    if (/T\d.*(Z|[+-]\d\d:?\d\d)$/.test(t) && !isNaN(new Date(t))) // a UTC time: take the date in Thailand
      return new Date(new Date(t).getTime() + 7 * 3600e3).toISOString().slice(0, 10);
    const y = Number(iso[1]) > 2400 ? Number(iso[1]) - 543 : Number(iso[1]);
    return `${y}-${iso[2]}-${iso[3]}`;
  }
  const m = t.match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
  if (!m) return null;
  let y = Number(m[3]);
  if (y < 100) y += y > 50 ? 2500 : 2000;
  if (y > 2400) y -= 543;
  return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}
const cellText = (v) => {
  if (v == null) return "";
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    if (v.richText) return v.richText.map((r) => r.text).join("");
    if (v.text != null) return String(v.text);
    if (v.result != null) return String(v.result);
    return "";
  }
  return String(v);
};

const COLS = {
  date: ["วันที่", "วันที่แจ้ง"],
  caseNo: ["เลขเคส"],
  unit: ["ช่องทางรับแจ้ง (รพ.สต.)", "หน่วยงาน", "รพ.สต."],
  province: ["จังหวัด"],
  project: ["โครงการ"],
  source: ["รับแจ้งจาก"],
  detail: ["รายละเอียดปัญหา", "ปัญหา"],
  cause: ["สาเหตุ", "สาเหตุของปัญหา"],
  solution: ["แนวทางการแก้ไข", "วิธีแก้ไขปัญหา", "วิธีแก้ไข"],
  solver: ["ผู้ดำเนินการ", "ผู้รับผิดชอบ"],
  duration: ["ระยะเวลาดำเนินการ"],
  type: ["ประเภทปัญหา"],
  status: ["สถานะ"],
};

async function importXlsx(buffer) {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); }
  catch { throw new Error("เปิดไฟล์ไม่ได้ ต้องเป็นไฟล์ .xlsx"); }

  let ws, headerRow, col;
  for (const sheet of wb.worksheets) {
    for (let r = 1; r <= Math.min(10, sheet.rowCount); r++) {
      const names = sheet.getRow(r).values.map((v) => cellText(v).trim());
      if (!names.includes("รายละเอียดปัญหา") && !names.includes("ปัญหา")) continue;
      col = {};
      for (const [key, opts] of Object.entries(COLS)) {
        const i = names.findIndex((n) => opts.includes(n));
        if (i > 0) col[key] = i;
      }
      ws = sheet; headerRow = r;
      break;
    }
    if (ws) break;
  }
  if (!ws) throw new Error('ไม่พบหัวคอลัมน์ "รายละเอียดปัญหา" ในไฟล์');
  if (!col.detail || !col.solution) throw new Error('ไฟล์ต้องมีคอลัมน์ "รายละเอียดปัญหา" และ "แนวทางการแก้ไข"');

  const get = (row, key) => (col[key] ? cellText(row.getCell(col[key]).value) : "");
  const records = [];
  for (let i = headerRow + 1; i <= ws.rowCount; i++) {
    const row = ws.getRow(i);
    const rec = {};
    for (const key of Object.keys(COLS)) rec[key] = get(row, key);
    records.push(rec);
  }
  return { ...ingest(records, { replace: false }), hasCause: !!col.cause };
}

/** Case-tracking API row (GET /api/v1/reports/case-summary) → the same shape as an Excel row. */
function fromApi(x) {
  return {
    caseNo: x.case_no || x.external_case_no || "",
    date: x.date, detail: x.detail || x.description_short, cause: x.root_cause, solution: x.resolution,
    solver: x.owner, duration: x.duration, type: x.problem_category, status: x.status,
    project: x.project_name, source: x.source_group_name, unit: x.agency_name || x.channel,
    province: x.province, agencyCode: x.agency_code,
    // reporter_name and anydesk_id are personal contact details: never stored
  };
}

/**
 * Store cleaned cases. replace: the records are the full list (an API snapshot), so cases
 * missing from it are removed and edited cases are updated, keyed by case number.
 */
function ingest(records, { replace }) {
  const r = { rows: 0, added: 0, updated: 0, duplicate: 0, notClosed: 0, noSolution: 0, noDetail: 0, privacyRemoved: 0, withCode: 0 };
  const cols = "id,case_no,date,project,source,unit,province,agency_code,detail,cause,solution,solver,duration,type,imported_at";
  const insert = db.prepare(`INSERT OR IGNORE INTO cases (${cols}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const upsert = db.prepare(`INSERT OR REPLACE INTO cases (${cols}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const exists = db.prepare("SELECT 1 FROM cases WHERE id = ?");
  const now = new Date().toISOString();
  const dash = (v) => { const t = String(v ?? "").trim(); return t === "-" ? "" : t; };

  db.exec("BEGIN");
  try {
    if (replace) db.exec("DELETE FROM cases");
    for (const rec of records) {
      const rawDetail = dash(rec.detail);
      if (!rawDetail) continue;
      r.rows++;
      const status = dash(rec.status).toLowerCase();
      if (status && !["closed", "resolved", "ปิด", "ปิดเคส", "เสร็จสิ้น"].includes(status)) { r.notClosed++; continue; }
      if (isDateOnly(rawDetail)) { r.noDetail++; continue; }
      const rawSol = dash(rec.solution);
      if (isUseless(rawSol)) { r.noSolution++; continue; }

      const d = scrub(rawDetail), s = scrub(rawSol), c = scrub(dash(rec.cause));
      if (d.hit || s.hit || c.hit) r.privacyRemoved++;
      const date = toISODate(rec.date);
      const caseNo = dash(rec.caseNo);
      // with a case number the case keeps one row, so an edited fix replaces the old one
      const id = caseNo ? "c:" + caseNo
        : crypto.createHash("sha1").update([date, rawDetail, rawSol, dash(rec.solver)].join("|")).digest("hex").slice(0, 24);
      const code = /^\d{1,5}$/.test(dash(rec.agencyCode)) ? dash(rec.agencyCode).padStart(5, "0") : null;
      const args = [id, caseNo, date, dash(rec.project), dash(rec.source), dash(rec.unit), dash(rec.province), code,
        d.text, c.text, s.text, dash(rec.solver), dash(rec.duration), dash(rec.type), now];
      if (code) r.withCode++;
      if (caseNo) {
        const had = !replace && exists.get(id);
        upsert.run(...args);
        had ? r.updated++ : r.added++;
      } else {
        insert.run(...args).changes ? r.added++ : r.duplicate++;
      }
    }
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
  r.locations = loc.applyLocations();
  index = null;
  clusterCache = null;
  return r;
}

/* ---------- search & frequent problems (logic in public/search-core.js) ---------- */
let index = null;
const getIndex = () => (index ||= core.makeIndex(db.prepare("SELECT * FROM cases ORDER BY date DESC").all()));
const search = (q, limit = 50, f = {}) => core.search(getIndex(), q, limit, f);

let clusterCache = null;
function frequent(limit = 40, days = 0, f = {}) {
  days = Math.max(0, Math.min(365, Number(days) || 0));
  const key = [days, Number(f.region) || 0, f.prov || "", f.unknown ? 1 : 0].join("|");
  clusterCache ||= {};
  if (!clusterCache[key]) clusterCache[key] = core.buildFrequent(getIndex(), days, core.areaFilter(f));
  const r = clusterCache[key];
  return { ...r, totalGroups: r.groups.length, groups: r.groups.slice(0, limit) };
}

/** Case counts per health region and province, for the area filter. */
function facets() {
  const regions = db.prepare("SELECT region, COUNT(*) n FROM cases WHERE region IS NOT NULL GROUP BY region ORDER BY region").all();
  const provinces = db.prepare("SELECT prov, region, COUNT(*) n FROM cases WHERE prov IS NOT NULL GROUP BY prov ORDER BY region, n DESC").all();
  const how = db.prepare("SELECT loc_src src, COUNT(*) n FROM cases GROUP BY loc_src").all();
  return { regions, provinces, how, hospitals: loc.hospitalStats() };
}

function stats() {
  const row = db.prepare("SELECT COUNT(*) n, MIN(date) first, MAX(date) last, MAX(imported_at) importedAt FROM cases").get();
  return { ...row };
}

module.exports = { importXlsx, ingest, fromApi, search, frequent, stats, facets, norm, resetIndex: () => { index = null; clusterCache = null; } };

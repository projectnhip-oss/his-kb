// พื้นที่ของเคส: จังหวัด → เขตสุขภาพ (ตารางคงที่) และรหัส 5 หลัก/ชื่อ รพ.สต. → จังหวัด (จากไฟล์รายชื่อสถานพยาบาล)
const ExcelJS = require("exceljs");
const { db } = require("./db");
const kbNorm = require("./public/norm.js");

/* ---------- 77 provinces: [province code, name, health region] ---------- */
const PROVINCES = [
  ["50", "เชียงใหม่", 1], ["57", "เชียงราย", 1], ["52", "ลำปาง", 1], ["51", "ลำพูน", 1], ["58", "แม่ฮ่องสอน", 1], ["55", "น่าน", 1], ["56", "พะเยา", 1], ["54", "แพร่", 1],
  ["63", "ตาก", 2], ["65", "พิษณุโลก", 2], ["67", "เพชรบูรณ์", 2], ["64", "สุโขทัย", 2], ["53", "อุตรดิตถ์", 2],
  ["62", "กำแพงเพชร", 3], ["66", "พิจิตร", 3], ["60", "นครสวรรค์", 3], ["61", "อุทัยธานี", 3], ["18", "ชัยนาท", 3],
  ["12", "นนทบุรี", 4], ["13", "ปทุมธานี", 4], ["14", "พระนครศรีอยุธยา", 4], ["15", "อ่างทอง", 4], ["16", "ลพบุรี", 4], ["17", "สิงห์บุรี", 4], ["19", "สระบุรี", 4], ["26", "นครนายก", 4],
  ["70", "ราชบุรี", 5], ["71", "กาญจนบุรี", 5], ["72", "สุพรรณบุรี", 5], ["73", "นครปฐม", 5], ["74", "สมุทรสาคร", 5], ["75", "สมุทรสงคราม", 5], ["76", "เพชรบุรี", 5], ["77", "ประจวบคีรีขันธ์", 5],
  ["11", "สมุทรปราการ", 6], ["20", "ชลบุรี", 6], ["21", "ระยอง", 6], ["22", "จันทบุรี", 6], ["23", "ตราด", 6], ["24", "ฉะเชิงเทรา", 6], ["25", "ปราจีนบุรี", 6], ["27", "สระแก้ว", 6],
  ["40", "ขอนแก่น", 7], ["44", "มหาสารคาม", 7], ["45", "ร้อยเอ็ด", 7], ["46", "กาฬสินธุ์", 7],
  ["41", "อุดรธานี", 8], ["47", "สกลนคร", 8], ["48", "นครพนม", 8], ["42", "เลย", 8], ["43", "หนองคาย", 8], ["39", "หนองบัวลำภู", 8], ["38", "บึงกาฬ", 8],
  ["30", "นครราชสีมา", 9], ["31", "บุรีรัมย์", 9], ["32", "สุรินทร์", 9], ["36", "ชัยภูมิ", 9],
  ["34", "อุบลราชธานี", 10], ["33", "ศรีสะเกษ", 10], ["35", "ยโสธร", 10], ["37", "อำนาจเจริญ", 10], ["49", "มุกดาหาร", 10],
  ["80", "นครศรีธรรมราช", 11], ["81", "กระบี่", 11], ["82", "พังงา", 11], ["83", "ภูเก็ต", 11], ["84", "สุราษฎร์ธานี", 11], ["85", "ระนอง", 11], ["86", "ชุมพร", 11],
  ["90", "สงขลา", 12], ["91", "สตูล", 12], ["92", "ตรัง", 12], ["93", "พัทลุง", 12], ["94", "ปัตตานี", 12], ["95", "ยะลา", 12], ["96", "นราธิวาส", 12],
  ["10", "กรุงเทพมหานคร", 13],
];
const BY_CODE = new Map(PROVINCES.map(([c, n]) => [c, n]));
const REGION = new Map(PROVINCES.map(([, n, r]) => [n, r]));
const NAMES_LONGEST_FIRST = PROVINCES.map((p) => p[1]).sort((a, b) => b.length - a.length);
const NICKNAMES = [["อยุธยา", "พระนครศรีอยุธยา"], ["โคราช", "นครราชสีมา"], ["กทม", "กรุงเทพมหานคร"], ["กรุงเทพ", "กรุงเทพมหานคร"], ["อุบล", "อุบลราชธานี"], ["อุดร", "อุดรธานี"], ["สุราษฎร์", "สุราษฎร์ธานี"], ["นครศรี", "นครศรีธรรมราช"], ["ประจวบ", "ประจวบคีรีขันธ์"]];

/** Find a province named anywhere in a piece of text ("SSO พิษณุโลก" → พิษณุโลก). */
function findProvince(text) {
  const t = String(text || "");
  if (!t || t === "-") return null;
  for (const n of NAMES_LONGEST_FIRST) if (t.includes(n)) return n;
  for (const [nick, n] of NICKNAMES) if (t.includes(nick)) return n;
  return null;
}
/** A province cell may hold a code ("65") or a name ("จ.พิษณุโลก"). */
function provinceFromCell(v) {
  const t = String(v ?? "").trim();
  if (/^\d{1,2}$/.test(t)) return BY_CODE.get(t.padStart(2, "0")) || null;
  if (/^\d{4,}$/.test(t)) return BY_CODE.get(t.slice(0, 2)) || null; // e.g. district/subdistrict code
  return findProvince(t.replace(/^จ(\.|ังหวัด)\s*/, ""));
}
const regionOf = (prov) => REGION.get(prov) || null;

/* ---------- hospital list ---------- */
db.exec(`
CREATE TABLE IF NOT EXISTS hospitals (
  hcode TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  province TEXT,
  district TEXT,
  region INTEGER
);
CREATE INDEX IF NOT EXISTS hospitals_name ON hospitals(name_key);
`);
for (const [col, type] of [["agency_code", "TEXT"], ["hcode", "TEXT"], ["hname", "TEXT"], ["prov", "TEXT"], ["region", "INTEGER"], ["loc_src", "TEXT"]]) {
  try { db.exec(`ALTER TABLE cases ADD COLUMN ${col} ${type}`); } catch { /* already there */ }
}

// "รพ.สต.บ้านโคกโขง" and "โรงพยาบาลส่งเสริมสุขภาพตำบลบ้านโคกโขง" → same key
const PREFIX = /โรงพยาบาลส่งเสริมสุขภาพตำบล|โรงพยาบาลส่งเสริมสุขภาพ|รพ\.?\s*สต\.?|รพสต\.?|สถานีอนามัย(เฉลิมพระเกียรติ.{0,40}?)?|ศูนย์สุขภาพชุมชน|สอ\.|ศสช\.?/g;
const nameKey = (s) => kbNorm(String(s || "").replace(PREFIX, " ")).replace(/\s/g, "");

const HEADERS = {
  code: ["รหัส 5 หลัก", "รหัสสถานพยาบาล", "รหัสหน่วยบริการ", "รหัสหน่วยงาน", "รหัสสถานบริการ", "hcode", "hospcode", "hoscode", "off_id", "code5", "รหัส"],
  name: ["ชื่อหน่วยบริการ", "ชื่อสถานพยาบาล", "ชื่อสถานบริการ", "ชื่อหน่วยงาน", "hosname", "hospname", "name", "ชื่อ"],
  province: ["จังหวัด", "ชื่อจังหวัด", "province", "changwat", "provname", "chwpart", "provcode", "รหัสจังหวัด"],
  district: ["อำเภอ", "ชื่ออำเภอ", "amphur", "district", "ampname"],
  region: ["เขตสุขภาพ", "เขตบริการ", "เขต", "region"],
};
function pickColumns(names) {
  const low = names.map((n) => String(n || "").trim().toLowerCase());
  const col = {};
  for (const [key, opts] of Object.entries(HEADERS)) {
    let i = low.findIndex((n) => opts.includes(n));
    if (i < 0) i = low.findIndex((n) => n && opts.some((o) => n.includes(o)));
    if (i >= 0 && !Object.values(col).includes(i)) col[key] = i;
  }
  return col;
}
function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (ch !== "\r") cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
const cellText = (v) => {
  if (v == null) return "";
  if (typeof v === "object") return v.richText ? v.richText.map((r) => r.text).join("") : String(v.text ?? v.result ?? "");
  return String(v);
};
async function readRows(buffer) {
  const isZip = buffer[0] === 0x50 && buffer[1] === 0x4b; // .xlsx is a zip file
  if (!isZip) {
    let text = buffer.toString("utf8").replace(/^﻿/, "");
    if (text.includes("�")) text = new TextDecoder("windows-874").decode(buffer); // Thai CSV saved by Excel
    return parseCsv(text);
  }
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); } catch { throw new Error("เปิดไฟล์ไม่ได้ ต้องเป็นไฟล์ .xlsx หรือ .csv"); }
  const ws = wb.worksheets.find((s) => s.rowCount > 1) || wb.worksheets[0];
  const rows = [];
  ws.eachRow({ includeEmpty: false }, (r) => rows.push(r.values.slice(1).map(cellText)));
  return rows;
}

async function importHospitals(buffer) {
  const rows = await readRows(buffer);
  let h = -1, col;
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const c = pickColumns(rows[i]);
    if (c.code != null && c.name != null) { h = i; col = c; break; }
  }
  if (h < 0) throw new Error('ไม่พบหัวคอลัมน์รหัส 5 หลักและชื่อสถานพยาบาล (เช่น "รหัส", "hcode", "ชื่อหน่วยบริการ")');
  if (col.province == null && col.region == null) throw new Error('ไฟล์ต้องมีคอลัมน์จังหวัด (ชื่อหรือรหัสจังหวัด) หรือเขตสุขภาพ');

  const r = { rows: 0, added: 0, noProvince: 0, badCode: 0 };
  const ins = db.prepare("INSERT OR REPLACE INTO hospitals (hcode,name,name_key,province,district,region) VALUES (?,?,?,?,?,?)");
  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM hospitals"); // the file is the full list: replace, don't merge
    for (const row of rows.slice(h + 1)) {
      const rawCode = String(row[col.code] ?? "").trim();
      const name = String(row[col.name] ?? "").trim();
      if (!rawCode && !name) continue;
      r.rows++;
      if (!/^\d{1,5}$/.test(rawCode)) { r.badCode++; continue; }
      const hcode = rawCode.padStart(5, "0"); // Excel drops leading zeros: 4835 → 04835
      const prov = col.province != null ? provinceFromCell(row[col.province]) : null;
      const reg = col.region != null && /\d/.test(String(row[col.region])) ? Number(String(row[col.region]).match(/\d+/)[0]) : null;
      if (!prov) r.noProvince++;
      ins.run(hcode, name, nameKey(name), prov, col.district != null ? String(row[col.district] ?? "").trim() : "", reg || regionOf(prov));
      r.added++;
    }
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
  hospitalIndex = null;
  r.matched = applyLocations();
  return r;
}

/* ---------- give every case a place ---------- */
let hospitalIndex = null;
function getHospitals() {
  if (hospitalIndex) return hospitalIndex;
  const byCode = new Map(), byName = new Map();
  for (const x of db.prepare("SELECT * FROM hospitals").all()) {
    byCode.set(x.hcode, x);
    if (!x.name_key) continue;
    if (!byName.has(x.name_key)) byName.set(x.name_key, []);
    byName.get(x.name_key).push(x);
  }
  return (hospitalIndex = { byCode, byName, size: byCode.size });
}

/**
 * Most certain first: a 5-digit code that is a real hospital in the hint province, then the
 * health-station name (unique, or unique within the hint province), then the province column,
 * then a province named in the channel or project ("SSO พิษณุโลก") — the last is an estimate.
 */
function resolve(c) {
  const H = getHospitals();
  const fromCol = findProvince(c.province);
  const fromChannel = findProvince(c.source) || findProvince(c.project);
  const hint = fromCol || fromChannel;
  const ok = (x) => !hint || !x.province || x.province === hint;

  // the case system's own agency code is the most reliable
  if (c.agency_code) {
    const x = H.byCode.get(c.agency_code);
    if (x) return place(x, "code");
    if (hint) return { hcode: c.agency_code, hname: c.unit || null, prov: hint, region: regionOf(hint), loc_src: fromCol ? "province" : "channel" };
  }
  if (H.size) {
    for (const text of [c.unit, c.detail]) {
      for (const m of String(text || "").matchAll(/(?<!\d)\d{5}(?!\d)/g)) {
        const x = H.byCode.get(m[0]);
        if (x && ok(x)) return place(x, "code");
      }
    }
    const list = H.byName.get(nameKey(c.unit));
    if (list) {
      const fit = list.filter(ok);
      if (fit.length === 1) return place(fit[0], "name");
    }
  }
  if (fromCol) return { hcode: null, hname: null, prov: fromCol, region: regionOf(fromCol), loc_src: "province" };
  if (fromChannel) return { hcode: null, hname: null, prov: fromChannel, region: regionOf(fromChannel), loc_src: "channel" };
  return { hcode: null, hname: null, prov: null, region: null, loc_src: null };
}
const place = (x, how) => ({ hcode: x.hcode, hname: x.name, prov: x.province, region: x.region || regionOf(x.province), loc_src: how });

function applyLocations() {
  const up = db.prepare("UPDATE cases SET hcode=?, hname=?, prov=?, region=?, loc_src=? WHERE id=?");
  const counts = { code: 0, name: 0, province: 0, channel: 0, none: 0 };
  db.exec("BEGIN");
  try {
    for (const c of db.prepare("SELECT id, unit, detail, province, source, project, agency_code FROM cases").all()) {
      const p = resolve(c);
      counts[p.loc_src || "none"]++;
      up.run(p.hcode, p.hname, p.prov, p.region, p.loc_src, c.id);
    }
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
  return counts;
}

function hospitalStats() {
  return db.prepare("SELECT COUNT(*) n, COUNT(DISTINCT province) provinces FROM hospitals").get();
}

module.exports = { PROVINCES, regionOf, findProvince, importHospitals, applyLocations, hospitalStats, nameKey };

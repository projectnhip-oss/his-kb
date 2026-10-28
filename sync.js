// ดึงเคสจากระบบรับแจ้งปัญหา (GET /api/v1/reports/case-summary) อัตโนมัติตามรอบเวลา
const { db } = require("./db");
const cases = require("./cases");

db.exec("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)");
const getS = (k, d = "") => db.prepare("SELECT value FROM settings WHERE key = ?").get(k)?.value ?? d;
const setS = (k, v) => db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(k, String(v ?? ""));

const DEFAULT_URL = "https://linemoph.bgs.co.th/api/v1/reports/case-summary";
const INTERVALS = [0, 30, 60, 180, 360, 1440]; // minutes; 0 = off

/** Expiry of a JWT (the part after the first dot holds "exp"), or null if it is not one. */
function tokenExpiry(token) {
  try {
    const p = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return p.exp ? new Date(p.exp * 1000).toISOString() : null;
  } catch { return null; }
}

function settings() {
  const token = getS("sync.token");
  return {
    url: getS("sync.url", DEFAULT_URL),
    interval: Number(getS("sync.interval", "60")),
    hasToken: !!token,
    tokenHint: token ? "…" + token.slice(-6) : "", // never send the token back to the page
    tokenExpires: token ? tokenExpiry(token) : null,
    lastRun: getS("sync.lastRun") || null,
    lastOk: getS("sync.lastOk") || null,
    lastStatus: getS("sync.lastStatus") || null, // ok | token_expired | error
    lastError: getS("sync.lastError") || null,
    lastResult: getS("sync.lastResult") ? JSON.parse(getS("sync.lastResult")) : null,
    running,
  };
}
function saveSettings({ url, token, interval }) {
  if (url !== undefined) {
    const u = String(url).trim() || DEFAULT_URL;
    if (!/^https?:\/\/[^\s]+$/i.test(u)) throw new Error("URL ไม่ถูกต้อง");
    setS("sync.url", u);
  }
  if (token !== undefined && String(token).trim()) {
    // accept a pasted "Bearer xxx" or "authorization: Bearer xxx" line too
    const t = String(token).trim().replace(/^authorization\s*:\s*/i, "").replace(/^bearer\s+/i, "").replace(/^"|"$/g, "").trim();
    if (/\s/.test(t) || t.length < 20) throw new Error("token ไม่ถูกต้อง ให้วางเฉพาะค่าหลังคำว่า Bearer");
    setS("sync.token", t);
    if (getS("sync.lastStatus") === "token_expired") setS("sync.lastStatus", "");
  }
  if (interval !== undefined) {
    const n = Number(interval);
    if (!INTERVALS.includes(n)) throw new Error("รอบเวลาไม่ถูกต้อง");
    setS("sync.interval", n);
  }
  return settings();
}
function clearToken() { setS("sync.token", ""); return settings(); }

let running = false;
async function syncNow() {
  if (running) throw new Error("กำลังดึงข้อมูลอยู่ รอสักครู่");
  const token = getS("sync.token");
  if (!token) throw new Error("ยังไม่ได้ใส่ token");
  running = true;
  setS("sync.lastRun", new Date().toISOString());
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 180e3);
    let res;
    try {
      res = await fetch(getS("sync.url", DEFAULT_URL), {
        headers: { Accept: "application/json", Authorization: "Bearer " + token },
        signal: ctrl.signal,
      });
    } catch (e) {
      throw new Error(e.name === "AbortError" ? "ระบบปลายทางตอบช้าเกิน 3 นาที" : "เชื่อมต่อระบบปลายทางไม่ได้ ตรวจอินเทอร์เน็ตของเครื่อง Server");
    } finally { clearTimeout(timer); }
    if (res.status === 401 || res.status === 403) {
      setS("sync.lastStatus", "token_expired");
      setS("sync.lastError", "token หมดอายุหรือไม่มีสิทธิ์ ให้วาง token ใหม่");
      throw Object.assign(new Error("token หมดอายุหรือไม่มีสิทธิ์ ให้วาง token ใหม่"), { expired: true });
    }
    if (!res.ok) throw new Error(`ระบบปลายทางตอบกลับ ${res.status}`);
    let data;
    try { data = await res.json(); } catch { throw new Error("ข้อมูลที่ได้ไม่ใช่ JSON"); }
    const list = Array.isArray(data) ? data : Object.values(data || {}).find(Array.isArray);
    if (!Array.isArray(list)) throw new Error("ไม่พบรายการเคสในข้อมูลที่ได้");
    if (!list.length) throw new Error("ระบบปลายทางส่งรายการว่างมา ไม่ได้แทนข้อมูลเดิม");
    if (!list.some((x) => x && (x.detail || x.description_short)))
      throw new Error("รูปแบบข้อมูลเปลี่ยนไป (ไม่พบช่อง detail) ไม่ได้แทนข้อมูลเดิม");

    // the endpoint returns every case, so the result replaces what was stored before
    const r = cases.ingest(list.map(cases.fromApi), { replace: true });
    const result = { received: list.length, kept: r.added + r.updated, notClosed: r.notClosed, noSolution: r.noSolution, privacyRemoved: r.privacyRemoved, withCode: r.withCode, locations: r.locations };
    setS("sync.lastOk", new Date().toISOString());
    setS("sync.lastStatus", "ok");
    setS("sync.lastError", "");
    setS("sync.lastResult", JSON.stringify(result));
    return result;
  } catch (e) {
    if (!e.expired) { setS("sync.lastStatus", "error"); setS("sync.lastError", e.message); }
    throw e;
  } finally {
    running = false;
  }
}

/** Check once a minute whether a scheduled pull is due. */
function startScheduler(log = console.log) {
  setInterval(async () => {
    const every = Number(getS("sync.interval", "60"));
    if (!every || running || !getS("sync.token") || getS("sync.lastStatus") === "token_expired") return;
    const last = Date.parse(getS("sync.lastRun") || 0) || 0;
    if (Date.now() - last < every * 60e3) return;
    try {
      const r = await syncNow();
      log(`[sync] ดึงเคสสำเร็จ ${r.kept} เคส`);
    } catch (e) { log(`[sync] ดึงเคสไม่สำเร็จ: ${e.message}`); }
  }, 60e3).unref();
}

module.exports = { settings, saveSettings, clearToken, syncNow, startScheduler, INTERVALS };

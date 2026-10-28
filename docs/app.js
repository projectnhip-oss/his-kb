"use strict";
const LEVELS = { user: "User แก้เองได้", support: "ทีม Support", escalate: "ส่งต่อหัวหน้า/Vendor" };
const SYSTEMS = ["HOSxP", "EHP", "JHCIS", "Authen สิทธิ์", "เครื่องพิมพ์", "เครือข่าย", "คอมพิวเตอร์", "อื่นๆ"];
const S = {
  me: null, articles: [], q: "", sys: "ทั้งหมด", userView: false, sel: null, ready: false, loadErr: "",
  tab: "articles", cases: null, caseStats: null, freq: null, freqDays: 15, freqCache: null, caseErr: "", area: { region: 0, prov: "", unknown: false }, facets: null,
};

const $ = (s, root = document) => root.querySelector(s);
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const terms = () => S.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
const isTeam = () => !!S.me;
const isAdmin = () => S.me?.role === "admin";
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function hl(text) {
  const ts = terms().map(esc).filter(Boolean);
  let h = esc(text);
  if (!ts.length) return h;
  const re = new RegExp("(" + ts.map(reEsc).join("|") + ")", "gi");
  return h.replace(re, "<mark>$1</mark>");
}
function toast(m) {
  const t = $("#toast");
  t.textContent = m;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.hidden = true), 2400);
}

async function api(method, url, body, raw) {
  // the GitHub Pages preview has no server: demo.js answers the same calls in the browser
  if (window.KB_DEMO) return window.KB_DEMO.api(method, url, body, raw);
  const opt = { method, headers: { "X-KB": "1" }, credentials: "same-origin" };
  if (raw) { opt.headers["Content-Type"] = raw.type; opt.body = raw; }
  else if (body !== undefined) { opt.headers["Content-Type"] = "application/json"; opt.body = JSON.stringify(body); }
  const res = await fetch(url, opt);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || "เกิดข้อผิดพลาด (" + res.status + ")"), { status: res.status });
  return data;
}

/* ---------- data ---------- */
async function load() {
  try {
    S.articles = await api("GET", "/api/articles");
    S.ready = true;
    S.loadErr = "";
  } catch (e) {
    S.loadErr = e.message;
  }
  if (S.sel && !S.articles.some((a) => a.id === S.sel)) S.sel = null;
  render();
}
async function loadMe() {
  try { S.me = (await api("GET", "/api/me")).user; } catch { S.me = null; }
  renderHeader();
}

function haystack(a) {
  if (a._h) return a._h;
  return (a._h = kbNorm([a.title, (a.aliases || []).join(" "), a.errorMsg, a.system, ...(a.causes || []).map((c) => c.cause + " " + (c.steps || []).join(" ")), a.verify, ...(a.images || []).map((i) => i.caption)]
    .join(" ")).replace(/\s/g, ""));
}
const net = (a) => a.feedback.up - a.feedback.down;
/** Share of the query's 3-letter chunks found in the article: Thai has no spaces, so
 *  "ปริ้นสติกเกอร์ไม่ได้" should still match "พิมพ์สติกเกอร์ยาไม่ออก". */
function matchScore(a, nq) {
  const h = haystack(a);
  const q = nq.replace(/\s/g, "");
  if (!q) return 1;
  if (nq.split(" ").every((t) => h.includes(t))) return 2;
  if (q.length < 4) return 0;
  let hit = 0, n = 0;
  for (let i = 0; i <= q.length - 3; i++, n++) if (h.includes(q.slice(i, i + 3))) hit++;
  return hit / n;
}
function visible() {
  // compare without spaces: Thai users type with and without them ("ส่ง 13 แฟ้ม" / "ส่ง13แฟ้ม")
  const nq = kbNorm(S.q);
  return S.articles
    .filter((a) => (!S.userView || a.userVisible) && (S.sys === "ทั้งหมด" || a.system === S.sys))
    .map((a) => [matchScore(a, nq), a])
    .filter(([s]) => s >= 0.6)
    .sort((x, y) => y[0] - x[0] || net(y[1]) - net(x[1]) || (y[1].updatedAt || "").localeCompare(x[1].updatedAt || ""))
    .map(([, a]) => a);
}

/* ---------- render ---------- */
function renderHeader() {
  $("#loginBtn").hidden = isTeam();
  $("#acctMenu").hidden = !isTeam();
  $("#userViewWrap").hidden = !isTeam();
  $("#addBtn").hidden = !isTeam() || S.userView;
  $("#subtitle").textContent = isTeam() ? "เจอปัญหาที่ User แจ้ง ค้นที่นี่ก่อนถามหัวหน้า" : "ค้นวิธีแก้ปัญหาที่พบบ่อยด้วยตัวเอง";
  if (S.me) $("#whoami").textContent = `${S.me.displayName} (${S.me.role === "admin" ? "ผู้ดูแลระบบ" : "ทีม"})`;
  document.querySelectorAll("[data-admin]").forEach((b) => (b.hidden = !isAdmin()));
  if (!isTeam()) { S.userView = false; S.tab = "articles"; }
  $("#userView").checked = S.userView;
  $("#tabs").hidden = !isTeam();
  document.querySelectorAll("#tabs [data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === S.tab)));
  $("#filters").hidden = S.tab !== "articles";
  $("#work").hidden = S.tab !== "articles";
  $("#caseView").hidden = S.tab === "articles";
  $("#n-articles").textContent = S.ready ? visible().length : "";
  $("#n-cases").textContent = S.cases ? S.cases.total.toLocaleString("th-TH") : "";
  document.documentElement.style.setProperty("--hdr", $(".top").offsetHeight + 16 + "px");
}
function renderFilters() {
  const used = new Set(S.articles.map((a) => a.system));
  const opts = ["ทั้งหมด", ...SYSTEMS.filter((s) => used.has(s)), ...[...used].filter((s) => s && !SYSTEMS.includes(s))];
  if (!opts.includes(S.sys)) S.sys = "ทั้งหมด";
  $("#filters").innerHTML = opts.map((s) => `<button class="chip" aria-pressed="${s === S.sys}" data-sys="${esc(s)}">${esc(s)}</button>`).join("");
}
function renderList() {
  const v = visible(), list = $("#list");
  if (S.loadErr) {
    $("#count").textContent = "";
    list.innerHTML = `<div class="empty"><h3>โหลดข้อมูลไม่สำเร็จ</h3>${esc(S.loadErr)} ลองรีเฟรชหน้า หรือแจ้งผู้ดูแลระบบ</div>`;
    return;
  }
  if (!S.ready) return;
  $("#count").textContent = `พบ ${v.length} เรื่อง${S.articles.length !== v.length ? ` จากทั้งหมด ${S.articles.length}` : ""}`;
  if (!S.articles.length) {
    list.innerHTML = `<div class="empty"><h3>ยังไม่มีปัญหาในคลัง</h3>${isTeam() ? 'กด "บันทึกปัญหาใหม่" เพื่อเพิ่มเรื่องแรก' : "ทีม Support ยังไม่ได้เปิดเรื่องใดให้ดู"}</div>`;
    return;
  }
  if (!v.length) {
    list.innerHTML = `<div class="empty"><h3>ไม่พบเรื่องที่ตรงกับ "${esc(S.q)}"</h3>${isTeam() ? "ลองใช้คำอื่นที่ User มักพูด หรือข้อความบางส่วนของ Error ถ้าแก้ได้แล้ว อย่าลืมบันทึกเป็นเรื่องใหม่" : "ลองใช้คำอื่น หรือแจ้งทีม Support"}</div>`;
    return;
  }
  list.innerHTML = v.map((a) => {
    const said = (a.aliases || []).join(" · ");
    return `<button class="item" data-id="${esc(a.id)}" aria-current="${a.id === S.sel}">
      <h3>${hl(a.title)}</h3>${said ? `<div class="said">${hl(said)}</div>` : ""}
      <div class="tags"><span class="tag">${esc(a.system)}</span><span class="tag lv lv-${esc(a.level)}">${esc(LEVELS[a.level] || "")}</span>${a.example ? '<span class="tag ex">ตัวอย่าง</span>' : ""}${a.causes.length > 1 ? `<span class="tag">${a.causes.length} สาเหตุ</span>` : ""}${a.images?.length ? `<span class="tag">${a.images.length} รูป</span>` : ""}</div>
    </button>`;
  }).join("");
}
function renderDetail() {
  const d = $("#detail"), a = S.articles.find((x) => x.id === S.sel);
  $("#work").classList.toggle("reading", !!a);
  if (!a) {
    d.innerHTML = `<div style="color:var(--muted)"><h2 style="color:var(--fg);font-size:1.15rem;margin-bottom:6px">เลือกปัญหาจากรายการ</h2>ค้นด้วยคำที่ User แจ้งมาได้เลย เช่น "ปริ้นไม่ออก" หรือข้อความ Error ระบบจะค้นทั้งชื่อปัญหา คำที่ User ใช้ สาเหตุ และขั้นตอนแก้ไข</div>`;
    return;
  }
  const { up, down, mine } = a.feedback;
  const canEdit = isTeam() && !S.userView;
  d.innerHTML = `<button class="btn back" id="backBtn">← กลับไปรายการ</button>
    ${S.userView ? '<div class="uview-banner" style="margin-bottom:12px">กำลังดูแบบที่ User จะเห็น</div>' : ""}
    <div class="d-head"><h2>${esc(a.title)}</h2>
      <div class="d-actions"><button class="btn small" id="linkBtn">คัดลอกลิงก์</button>${canEdit ? `<button class="btn small" id="editBtn">แก้ไข</button><button class="btn small danger" id="delBtn">ลบ</button>` : ""}</div></div>
    <div class="tags"><span class="tag">${esc(a.system)}</span><span class="tag lv lv-${esc(a.level)}">${esc(LEVELS[a.level] || "")}</span>${isTeam() ? (a.userVisible ? '<span class="tag lv-user">เปิดให้ User เห็น</span>' : '<span class="tag">เฉพาะทีม</span>') : ""}${a.example ? '<span class="tag ex">ข้อมูลตัวอย่าง แก้หรือลบได้</span>' : ""}</div>
    <div id="delConfirm"></div>
    ${a.aliases.length ? `<div class="sec"><div class="sec-label">User มักแจ้งว่า</div><div class="said-list">${a.aliases.map((s) => `<span>"${esc(s)}"</span>`).join("")}</div></div>` : ""}
    ${a.errorMsg ? `<div class="sec"><div class="sec-label">ข้อความ Error</div><div class="err"><span id="errTxt">${esc(a.errorMsg)}</span><button id="copyErr">คัดลอก</button></div></div>` : ""}
    <div class="sec"><div class="sec-label">สาเหตุและวิธีแก้ (${a.causes.length})</div>
      ${a.causes.map((c, i) => `<details class="cause" ${i === 0 ? "open" : ""}><summary><span class="n">${String(i + 1).padStart(2, "0")}</span><span>${esc(c.cause)}</span></summary><ol class="steps">${c.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol></details>`).join("")}
    </div>
    ${a.images?.length ? `<div class="sec"><div class="sec-label">รูปประกอบ</div><div class="gallery">${a.images.map((im, i) => `<figure><a href="${esc(im.url)}" target="_blank" rel="noopener" data-zoom="${i}"><img src="${esc(im.url)}" alt="${esc(im.caption || a.title)}" loading="lazy"></a>${im.caption ? `<figcaption>${esc(im.caption)}</figcaption>` : ""}</figure>`).join("")}</div></div>` : ""}
    ${a.verify ? `<div class="sec"><div class="sec-label">ตรวจว่าแก้สำเร็จ</div><div class="verify">${esc(a.verify)}</div></div>` : ""}
    <div class="feedback"><span>วิธีนี้ช่วยได้ไหม</span>
      <button class="btn" id="fbUp" aria-pressed="${mine === 1}">ช่วยได้ · ${up}</button>
      <button class="btn" id="fbDown" aria-pressed="${mine === -1}">ไม่ได้ผล · ${down}</button></div>
    <div class="foot">${a.updatedAt ? `อัปเดตล่าสุด ${new Date(a.updatedAt).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })}` : ""}${isTeam() && a.updatedByName ? " โดย " + esc(a.updatedByName) : ""}</div>`;
}
function render() {
  renderFilters();
  renderHeader();
  if (S.tab === "articles") { renderList(); renderDetail(); }
  else if (S.tab === "cases") renderCases();
  else renderFrequent();
}

/* ---------- past cases ---------- */
const fmtDate = (d) => (d ? new Date(d + "T00:00:00").toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" }) : "");
let caseTimer = null, caseSeq = 0;
function searchCases(immediate) {
  if (!isTeam()) return;
  clearTimeout(caseTimer);
  caseTimer = setTimeout(async () => {
    const seq = ++caseSeq;
    try {
      const r = await api("GET", "/api/cases/search?q=" + encodeURIComponent(S.q) + areaQS());
      if (seq !== caseSeq) return; // a newer search already went out
      S.cases = r;
      S.caseErr = "";
    } catch (e) { S.caseErr = e.message; }
    renderHeader();
    if (S.tab === "cases") renderCases();
  }, immediate ? 0 : 250);
}
async function loadCaseStats() {
  if (!isTeam()) return;
  try { S.caseStats = await api("GET", "/api/cases/stats"); } catch { S.caseStats = null; }
  try { S.facets = await api("GET", "/api/cases/facets"); } catch { S.facets = null; }
  try { S.sync = await api("GET", "/api/sync"); } catch { S.sync = null; }
}
/* ---------- area filter: health region / province ---------- */
const pad2 = (n) => String(n).padStart(2, "0");
function areaQS() {
  const a = S.area;
  if (a.unknown) return "&area=unknown";
  return (a.region ? `&region=${a.region}` : "") + (a.prov ? `&prov=${encodeURIComponent(a.prov)}` : "");
}
const areaKey = () => `${S.area.unknown ? "u" : S.area.region}|${S.area.prov}`;
function areaLabel() {
  const a = S.area;
  if (a.unknown) return "เคสที่ไม่ทราบพื้นที่";
  if (a.prov) return `จ.${a.prov}`;
  if (a.region) return `เขตสุขภาพที่ ${a.region}`;
  return "";
}
function areaBar() {
  const f = S.facets;
  if (!f || !f.regions.length) return "";
  const a = S.area, total = S.caseStats?.n || 0;
  const known = f.regions.reduce((t, r) => t + r.n, 0);
  const regionVal = a.unknown ? "unknown" : String(a.region || "");
  const provs = a.region ? f.provinces.filter((p) => p.region === a.region) : [];
  const hosp = f.hospitals?.n ? "" : ` <span class="hint-inline">นำเข้ารายชื่อสถานพยาบาลเพื่อจับคู่จากรหัส/ชื่อ รพ.สต. ได้แม่นขึ้น</span>`;
  return `<div class="area">
    <label for="f-region">เขตสุขภาพ</label>
    <select id="f-region"><option value="">ทุกเขต (${total.toLocaleString("th-TH")})</option>
      ${f.regions.map((r) => `<option value="${r.region}" ${regionVal === String(r.region) ? "selected" : ""}>เขต ${pad2(r.region)} (${r.n.toLocaleString("th-TH")})</option>`).join("")}
      <option value="unknown" ${a.unknown ? "selected" : ""}>ไม่ทราบพื้นที่ (${(total - known).toLocaleString("th-TH")})</option></select>
    ${provs.length ? `<label for="f-prov">จังหวัด</label><select id="f-prov"><option value="">ทุกจังหวัดในเขต</option>${provs.map((p) => `<option ${a.prov === p.prov ? "selected" : ""}>${esc(p.prov)}</option>`).join("")}</select>` : ""}
    ${hosp}</div>`;
}
function caseLoc(c) {
  if (!c.prov) return "";
  const est = c.locSrc === "channel" ? ' <span class="est" title="ประมาณจากช่องทางรับแจ้งหรือโครงการ">ประมาณการ</span>' : "";
  return `<span class="loc">เขต ${pad2(c.region)} · ${esc(c.prov)}${c.hname ? ` · ${esc(c.hname)}` : ""}${c.hcode ? ` (${esc(c.hcode)})` : ""}${est}</span>`;
}
$("#caseView").addEventListener("change", (e) => {
  if (e.target.id === "f-region") {
    const v = e.target.value;
    S.area = { region: v && v !== "unknown" ? Number(v) : 0, prov: "", unknown: v === "unknown" };
  } else if (e.target.id === "f-prov") S.area = { ...S.area, prov: e.target.value };
  else return;
  S.cases = null;
  if (S.tab === "cases") { $("#caseView").innerHTML = areaBar() + '<div class="meta-line">กำลังค้นหา…</div>'; searchCases(true); }
  else renderFrequent();
});

const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" }) : "");
/** One line saying how fresh the case data is; a warning when the automatic pull has stopped. */
function syncNote() {
  const y = S.sync;
  if (!y || !y.hasToken) return "";
  if (y.lastStatus === "token_expired")
    return `<div class="notice">ข้อมูลเคสหยุดอัปเดตตั้งแต่ ${fmtTime(y.lastOk) || "-"} เพราะ token ของระบบรับแจ้งปัญหาหมดอายุ ${isAdmin() ? '<button class="btn small" data-open-sync>วาง token ใหม่</button>' : "แจ้งผู้ดูแลระบบให้วาง token ใหม่"}</div>`;
  if (y.lastStatus === "error" && isAdmin())
    return `<div class="notice">ดึงข้อมูลจากระบบรับแจ้งปัญหาไม่สำเร็จครั้งล่าสุด <button class="btn small" data-open-sync>ดูรายละเอียด</button></div>`;
  return y.lastOk ? `<div class="meta-line"><span>ข้อมูลจากระบบรับแจ้งปัญหา อัปเดตล่าสุด ${fmtTime(y.lastOk)}</span></div>` : "";
}

function noCasesYet() {
  return `<div class="empty"><h3>ยังไม่มีเคสเก่าในระบบ</h3>${isAdmin()
    ? '<button class="btn small" data-open-sync>เชื่อมต่อระบบรับแจ้งปัญหา (API)</button> เพื่อดึงเคสอัตโนมัติ หรือ <button class="btn small" data-import-cases>นำเข้าเคสจาก Excel</button> ที่ Export มา ระบบจะเก็บเฉพาะเคสที่ปิดแล้วและมีวิธีแก้'
    : "ให้ผู้ดูแลระบบนำเข้าไฟล์ Excel ที่ Export จากระบบรับแจ้งปัญหา"}</div>`;
}
function renderCases() {
  const v = $("#caseView");
  if (S.caseErr) { v.innerHTML = `<div class="empty"><h3>ค้นเคสไม่สำเร็จ</h3>${esc(S.caseErr)}</div>`; return; }
  if (!S.cases || !S.caseStats) { v.innerHTML = `<div class="meta-line">กำลังโหลด…</div>`; return; }
  if (!S.caseStats.n) { v.innerHTML = noCasesYet(); return; }
  const st = S.caseStats, r = S.cases, q = S.q.trim();
  const range = `${fmtDate(st.first)} – ${fmtDate(st.last)}`;
  const inArea = areaLabel() ? ` ใน${areaLabel()}` : "";
  let html = syncNote() + areaBar() + `<div class="meta-line"><span>${q ? `พบ ${r.total.toLocaleString("th-TH")} เคสที่คล้ายกัน${inArea}` : `เคสล่าสุด${inArea}`} จากทั้งหมด ${st.n.toLocaleString("th-TH")} เคส (${range})</span><span>${q ? "เรียงตามความคล้าย" : ""}</span></div>`;
  if (!r.results.length) {
    v.innerHTML = html + `<div class="empty"><h3>ไม่พบเคสที่คล้ายกับ "${esc(q)}"${inArea}</h3>ลองพิมพ์สั้นลง หรือใช้คำหลักของปัญหา เช่น "ปิดสิทธิ", "สติกเกอร์", "13 แฟ้ม"</div>`;
    return;
  }
  // fixes that several similar cases share are the safest first thing to try
  if (q) {
    const groups = new Map();
    for (const c of r.results) {
      const g = groups.get(c.solKey) || { text: c.solution, n: 0 };
      g.n++;
      groups.set(c.solKey, g);
    }
    const common = [...groups.values()].filter((g) => g.n >= 2).sort((a, b) => b.n - a.n).slice(0, 3);
    if (common.length)
      html += `<div class="common-fixes"><h3>วิธีแก้ที่ใช้ซ้ำในเคสที่คล้ายกัน</h3>${common
        .map((g) => `<div class="fix-row"><span class="fix-n">${g.n} เคส</span><span style="white-space:pre-wrap">${esc(g.text)}</span></div>`).join("")}</div>`;
  }
  html += `<div class="case-list">${r.results.map((c) => `<article class="case">
      <div class="q">${hl(c.detail)}</div>
      ${c.cause ? `<div class="c">${esc(c.cause)}</div>` : ""}
      <div class="a">${hl(c.solution)}</div>
      <div class="case-foot">
        ${c.type ? `<span class="tag">${esc(c.type)}</span>` : ""}${c.project ? `<span class="tag">${esc(c.project)}</span>` : ""}
        ${caseLoc(c)}<span>${fmtDate(c.date)}</span>${c.solver ? `<span>แก้โดย ${esc(c.solver)}</span>` : ""}${c.duration ? `<span>ใช้เวลา ${esc(c.duration)}</span>` : ""}${c.caseNo ? `<span>${esc(c.caseNo)}</span>` : ""}
        <button class="btn small" data-promote="${esc(c.id)}">สร้างบทความจากเคสนี้</button>
      </div></article>`).join("")}</div>`;
  if (r.total > r.results.length) html += `<div class="meta-line"><span>แสดง ${r.results.length} เคสแรก พิมพ์คำค้นให้เจาะจงขึ้นเพื่อดูเคสที่ตรงกว่า</span></div>`;
  v.innerHTML = html;
}
const FREQ_DAYS = [[7, "7 วัน"], [15, "15 วัน"], [30, "30 วัน"], [0, "ทั้งหมด"]];
const grams3 = (t) => {
  const x = kbNorm(t).replace(/\s/g, ""), out = new Set();
  for (let i = 0; i <= x.length - 3; i++) out.add(x.slice(i, i + 3));
  return out;
};
const dice = (a, b) => {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const g of a) if (b.has(g)) n++;
  return (2 * n) / (a.size + b.size);
};
/** The article written for this same problem: compared on its title and the wordings
 *  users send (aliases) only, since steps share too many words with unrelated problems. */
function articleFor(f) {
  const mine = [f.title, ...f.variants].map((t) => grams3(t.split("\n")[0]));
  let best = null, bestScore = 0;
  for (const a of S.articles) {
    a._g ||= [a.title, ...(a.aliases || [])].map(grams3);
    for (const g of a._g) for (const m of mine) {
      const sc = dice(g, m);
      if (sc > bestScore) { bestScore = sc; best = a; }
    }
  }
  return bestScore >= 0.7 ? best : null;
}
function trendChip(f, r) {
  if (!r.days || !r.prevComplete || f.prevCount == null) return "";
  const d = f.count - f.prevCount;
  if (f.prevCount === 0) return `<span class="trend up">ใหม่ใน ${r.days} วันนี้</span>`;
  if (d > 0) return `<span class="trend up">▲ +${d} จาก ${r.days} วันก่อนหน้า</span>`;
  if (d < 0) return `<span class="trend down">▼ ${d} จาก ${r.days} วันก่อนหน้า</span>`;
  return `<span class="trend">เท่ากับ ${r.days} วันก่อนหน้า</span>`;
}
const clip = (t, n) => (t.length > n ? t.slice(0, n) + "…" : t);
/** Problems reported only once in the window: not a pattern yet, but still worth a look with their fix. */
function singlesBlock(r) {
  if (!r.singles?.length) return "";
  S.singles = r.singles;
  return `<h3 class="sec-title">แจ้งครั้งเดียวในช่วงนี้ <span class="tab-n">${r.totalSingles.toLocaleString("th-TH")}</span></h3>
    <div class="case-list">${r.singles.map((c) => `<article class="case">
      <div class="q">${esc(c.detail)}</div>
      ${c.cause ? `<div class="c">${esc(c.cause)}</div>` : ""}
      <div class="a">${esc(c.solution)}</div>
      <div class="case-foot">${c.type ? `<span class="tag">${esc(c.type)}</span>` : ""}${caseLoc(c)}<span>${fmtDate(c.date)}</span>${c.solver ? `<span>แก้โดย ${esc(c.solver)}</span>` : ""}
        <button class="btn small" data-promote-single="${esc(c.id)}">สร้างบทความจากเคสนี้</button></div>
    </article>`).join("")}</div>
    ${r.totalSingles > r.singles.length ? `<div class="meta-line"><span>แสดง ${r.singles.length} เคสล่าสุด ดูทั้งหมดได้ที่แท็บเคสที่เคยแก้</span></div>` : ""}`;
}
async function renderFrequent() {
  const v = $("#caseView");
  if (!S.caseStats) { v.innerHTML = `<div class="meta-line">กำลังโหลด…</div>`; return; }
  if (!S.caseStats.n) { v.innerHTML = noCasesYet(); return; }
  const days = S.freqDays;
  const picker = `<div class="seg" role="group" aria-label="ช่วงเวลา">${FREQ_DAYS.map(([d, l]) => `<button data-days="${d}" aria-pressed="${d === days}">${l}</button>`).join("")}</div>`;
  S.freqCache ||= {};
  const key = days + "|" + areaKey();
  if (!S.freqCache[key]) {
    v.innerHTML = `<div class="freq-head">${picker}${areaBar()}<span class="meta-line">กำลังจัดกลุ่มปัญหา…</span></div>`;
    try { S.freqCache[key] = await api("GET", `/api/cases/frequent?limit=40&days=${days}${areaQS()}`); }
    catch (e) { v.innerHTML = `<div class="empty"><h3>โหลดไม่สำเร็จ</h3>${esc(e.message)}</div>`; return; }
    if (S.tab !== "frequent" || S.freqDays !== days || days + "|" + areaKey() !== key) return;
  }
  const r = S.freqCache[key];
  S.freq = r.groups;
  const span = r.from ? `${fmtDate(r.from)} – ${fmtDate(r.to)}` : `${fmtDate(S.caseStats.first)} – ${fmtDate(S.caseStats.last)}`;
  const note = r.days && !r.prevComplete ? " ยังไม่มีข้อมูลย้อนหลังพอจะเทียบกับช่วงก่อนหน้า" : "";
  let html = syncNote() + `<div class="freq-head">${picker}${areaBar()}<span class="meta-line">${areaLabel() ? areaLabel() + " · " : ""}${r.days ? `${r.days} วันล่าสุดของข้อมูล` : "ข้อมูลทั้งหมด"} (${span}) · ${r.totalInWindow.toLocaleString("th-TH")} เคส · ปัญหาที่แจ้งซ้ำ ${r.totalGroups ?? r.groups.length} กลุ่ม${(r.totalGroups ?? 0) > r.groups.length ? ` (แสดง ${r.groups.length} กลุ่มแรก)` : ""}${note}</span></div>`;
  if (!r.groups.length) {
    html += `<div class="notice">ไม่มีปัญหาที่ถูกแจ้งซ้ำ${areaLabel() ? `ใน${areaLabel()} ` : ""}ในช่วงนี้ ${r.totalSingles ? `ด้านล่างคือเคสทั้ง ${r.totalSingles} เคสที่แจ้งเข้ามา พร้อมวิธีแก้` : "ลองเลือกช่วงเวลาที่ยาวขึ้น"}</div>`;
    v.innerHTML = html + singlesBlock(r);
    return;
  }
  html += r.groups.map((f, i) => {
    const art = articleFor(f);
    let fix;
    if (art) {
      const c = art.causes[0], top = f.solutions[0];
      fix = `<div class="fix-src">ขั้นตอนจากบทความ "${esc(art.title)}"${art.causes.length > 1 ? ` (สาเหตุที่ 1 จาก ${art.causes.length})` : ""}</div>
        ${c.cause ? `<div class="fix-cause">${esc(c.cause)}</div>` : ""}
        <ol class="steps">${c.steps.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>
        ${top ? `<div class="fix-src">วิธีแก้ที่ใช้บ่อยในเคส</div><ul class="other-fixes"><li>${esc(clip(top.text, 220))}${top.n > 1 ? ` <span class="fix-n">${top.n} เคส</span>` : ""}</li></ul>` : ""}`;
    } else if (f.solutions.length) {
      const [top, ...rest] = f.solutions;
      fix = `<div class="fix-src">วิธีแก้ที่ใช้บ่อยที่สุด${top.n > 1 ? ` <span class="fix-n">${top.n} เคส</span>` : ""}</div>
        <ol class="steps">${splitSteps(top.text).map((x) => `<li>${esc(clip(x, 400))}</li>`).join("")}</ol>
        ${rest.length ? `<div class="fix-src">วิธีอื่นที่เคยใช้</div><ul class="other-fixes">${rest.map((x) => `<li>${esc(clip(x.text, 220))}${x.n > 1 ? ` <span class="fix-n">${x.n} เคส</span>` : ""}</li>`).join("")}</ul>` : ""}`;
    } else fix = '<div class="variants">ยังไม่มีวิธีแก้ที่เขียนไว้ชัดเจน</div>';
    return `<article class="freq">
      <div class="freq-n">${f.count}<small>เคส</small></div>
      <div class="freq-title"><h3>${esc(f.title)}</h3>${trendChip(f, r)}</div>
      ${f.variants.length ? `<div class="variants">แจ้งแบบอื่น: ${f.variants.map((x) => `"${esc(clip(x, 60))}"`).join(", ")}</div>` : '<div class="variants"></div>'}
      <div class="freq-fix">${fix}</div>
      <div class="freq-actions"><button class="btn small" data-freq-search="${i}">ดูเคสทั้งหมด</button>${art
        ? `<button class="btn small" data-open-article="${esc(art.id)}">เปิดบทความ</button>`
        : `<button class="btn small primary" data-freq-promote="${i}">สร้างบทความ</button>`}</div>
    </article>`;
  }).join("");
  html += singlesBlock(r);
  v.innerHTML = html;
}
function switchTab(t) {
  S.tab = t;
  if (t !== "articles" && !S.caseStats) loadCaseStats().then(render);
  if (t === "cases" && !S.cases) searchCases(true);
  render();
}

/** Turn a free-text fix into numbered steps when it already reads as a list. */
function splitSteps(text) {
  const t = String(text || "").trim();
  if (/(^|\s)1[.)]\s*\S/.test(t) && /(^|\s)2[.)]\s*\S/.test(t))
    return t.split(/(?:^|\s+)(?=\d{1,2}[.)]\s*\S)/).map((s) => s.replace(/^\d{1,2}[.)]\s*/, "").trim()).filter(Boolean);
  const lines = t.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  return lines.length ? lines : [t];
}
function draftFromCase(c) {
  return {
    title: c.detail.split("\n")[0].slice(0, 200), aliases: [c.detail.split("\n")[0].slice(0, 200)], errorMsg: "",
    system: "EHP", level: "support", userVisible: false,
    causes: [{ cause: c.cause || "", steps: splitSteps(c.solution) }], verify: "", images: [],
  };
}
function draftFromCluster(f) {
  const sols = f.solutions.length ? f.solutions : [{ text: "" }];
  return {
    title: f.title.split("\n")[0].slice(0, 200), aliases: [f.title, ...f.variants].map((x) => x.split("\n")[0].slice(0, 200)),
    errorMsg: "", system: "EHP", level: "support", userVisible: false,
    causes: sols.map((s, i) => ({ cause: s.text ? `วิธีที่ ${i + 1}${s.n > 1 ? ` (ใช้แก้ ${s.n} เคส)` : ""}` : "", steps: s.text ? splitSteps(s.text) : [] })), verify: "", images: [],
  };
}

$("#tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) switchTab(b.dataset.tab); });
$("#caseView").addEventListener("click", (e) => {
  const t = e.target;
  if (t.matches("[data-import-cases]")) return openImportCases();
  if (t.dataset.promote) {
    const c = S.cases.results.find((x) => x.id === t.dataset.promote);
    if (c) openEditor(null, draftFromCase(c));
    return;
  }
  if (t.dataset.freqSearch) {
    S.q = S.freq[t.dataset.freqSearch].title.split("\n")[0];
    $("#q").value = S.q;
    S.cases = null;
    searchCases(true);
    switchTab("cases");
    return;
  }
  if (t.dataset.freqPromote) return openEditor(null, draftFromCluster(S.freq[t.dataset.freqPromote]));
  if (t.matches("[data-open-sync]")) return openSync();
  if (t.dataset.promoteSingle) {
    const c = (S.singles || []).find((x) => x.id === t.dataset.promoteSingle);
    if (c) openEditor(null, draftFromCase(c));
    return;
  }
  if (t.dataset.days != null) { S.freqDays = Number(t.dataset.days); return renderFrequent(); }
  if (t.dataset.openArticle) { S.tab = "articles"; render(); select(t.dataset.openArticle); }
});

const SYNC_EVERY = [[0, "ปิดการดึงอัตโนมัติ"], [30, "ทุก 30 นาที"], [60, "ทุก 1 ชั่วโมง"], [180, "ทุก 3 ชั่วโมง"], [360, "ทุก 6 ชั่วโมง"], [1440, "วันละครั้ง"]];
async function openSync() {
  let st;
  try { st = await api("GET", "/api/sync"); } catch (e) { toast(e.message); return; }
  const draw = (st, msg = "", err = "") => {
    const exp = st.tokenExpires ? new Date(st.tokenExpires) : null;
    const left = exp ? exp - Date.now() : null;
    const expText = !st.hasToken ? "ยังไม่มี token"
      : !exp ? `มี token แล้ว (${esc(st.tokenHint)}) ไม่ทราบวันหมดอายุ`
      : left <= 0 ? `<b style="color:var(--danger)">token หมดอายุแล้ว</b> เมื่อ ${fmtTime(st.tokenExpires)}`
      : `มี token แล้ว (${esc(st.tokenHint)}) หมดอายุ ${fmtTime(st.tokenExpires)}${left < 864e5 ? ' <b style="color:var(--warn)">เหลือไม่ถึง 1 วัน</b>' : ""}`;
    const status = st.lastStatus === "ok" ? `<span class="lv-user tag">สำเร็จ</span> ${fmtTime(st.lastOk)}`
      : st.lastStatus === "token_expired" ? `<span class="tag lv-escalate">token หมดอายุ</span> ${esc(st.lastError || "")}`
      : st.lastStatus === "error" ? `<span class="tag lv-escalate">ไม่สำเร็จ</span> ${esc(st.lastError || "")}`
      : "ยังไม่เคยดึงข้อมูล";
    const lr = st.lastResult;
    const sh = openSheet(`<form class="sheet-panel" id="syncForm" novalidate>
      <h2>เชื่อมต่อระบบรับแจ้งปัญหา (API)</h2>
      <p style="margin:0;color:var(--muted)">Server ดึงเคสทั้งหมดจากระบบรับแจ้งปัญหาตามรอบเวลา แทนการ Export Excel เอง เคสที่ถูกแก้ไขในระบบต้นทางจะอัปเดตตาม และได้สาเหตุกับรหัสหน่วยงาน 5 หลักมาด้วย</p>
      <div class="verify" style="display:grid;gap:4px">
        <div><b>Token:</b> ${expText}</div>
        <div><b>ดึงข้อมูลล่าสุด:</b> ${status}</div>
        ${lr && st.lastStatus === "ok" ? `<div style="font-size:.88rem">ได้ ${lr.received.toLocaleString("th-TH")} เคส · เก็บ ${lr.kept.toLocaleString("th-TH")} เคส · ข้ามเคสยังไม่ปิด ${lr.notClosed.toLocaleString("th-TH")} · ไม่มีวิธีแก้ ${lr.noSolution.toLocaleString("th-TH")} · มีรหัสหน่วยงาน 5 หลัก ${(lr.withCode || 0).toLocaleString("th-TH")}</div>` : ""}
      </div>
      <div class="field"><label for="sy-token">Token ${st.hasToken ? "(วางใหม่เพื่อเปลี่ยน)" : ""}</label>
        <textarea id="sy-token" class="mono" rows="3" placeholder="วางค่าหลังคำว่า Bearer จาก DevTools > Network > case-summary > Headers > Authorization" autocomplete="off" spellcheck="false"></textarea>
        <span class="hint">token เก็บไว้บนเครื่อง Server และไม่แสดงกลับในหน้าเว็บ ใช้ได้จนหมดอายุ ถ้าได้ API Key ถาวรจากผู้ดูแลระบบรับแจ้งปัญหา ให้วางที่นี่แทน</span></div>
      <div class="row2">
        <div class="field"><label for="sy-every">ดึงข้อมูลอัตโนมัติ</label><select id="sy-every">${SYNC_EVERY.map(([v, l]) => `<option value="${v}" ${v === st.interval ? "selected" : ""}>${l}</option>`).join("")}</select></div>
        <div class="field"><label for="sy-url">URL ของ API</label><input id="sy-url" value="${esc(st.url)}" placeholder="https://.../api/v1/reports/case-summary" spellcheck="false"></div>
      </div>
      <div class="form-err" id="formErr">${esc(err)}</div>
      ${msg ? `<div class="verify">${msg}</div>` : ""}
      <div class="sheet-actions">
        ${st.hasToken ? '<button type="button" class="btn danger" id="syClear">ลบ token</button>' : ""}
        <button type="button" class="btn" data-close>ปิด</button>
        <button type="submit" class="btn">บันทึก</button>
        <button type="button" class="btn primary" id="syRun">บันทึกและดึงข้อมูลตอนนี้</button>
      </div>
    </form>`, true);
    const save = () => api("PUT", "/api/sync", { token: $("#sy-token").value, interval: Number($("#sy-every").value), url: $("#sy-url").value });
    $("#syncForm").onsubmit = async (e) => {
      e.preventDefault();
      try { draw(await save(), "บันทึกแล้ว"); } catch (er) { $("#formErr").textContent = er.message; }
    };
    sh.onclick = async (e) => {
      const id = e.target.id;
      if (e.target.matches("[data-close]")) return closeSheet();
      if (id === "syClear") {
        try { draw(await api("DELETE", "/api/sync/token"), "ลบ token แล้ว การดึงอัตโนมัติหยุดทำงาน"); } catch (er) { $("#formErr").textContent = er.message; }
        return;
      }
      if (id !== "syRun") return;
      const btn = e.target;
      try { await save(); } catch (er) { $("#formErr").textContent = er.message; return; }
      btn.disabled = true;
      btn.textContent = "กำลังดึงข้อมูล… (ประมาณ 10–30 วินาที)";
      $("#formErr").textContent = "";
      try {
        const r = await api("POST", "/api/sync/run");
        draw(r.settings, `ดึงข้อมูลสำเร็จ เก็บ ${r.result.kept.toLocaleString("th-TH")} เคส`);
        S.cases = null; S.freqCache = null;
        await loadCaseStats();
        searchCases(true);
        render();
      } catch (er) {
        try { draw(await api("GET", "/api/sync"), "", er.message); } catch { $("#formErr").textContent = er.message; }
      }
    };
  };
  draw(st);
}
function openImportHospitals() {
  const h = S.facets?.hospitals;
  const sh = openSheet(`<div class="sheet-panel">
    <h2>นำเข้ารายชื่อสถานพยาบาล</h2>
    <p style="margin:0;color:var(--muted)">ไฟล์ .xlsx หรือ .csv รายชื่อสถานพยาบาลทั้งประเทศ ใช้จับคู่เคสกับ รพ.สต. จากรหัส 5 หลักหรือชื่อ แล้วบอกจังหวัดและเขตสุขภาพ ${h?.n ? `<br>ตอนนี้มี ${h.n.toLocaleString("th-TH")} แห่ง ใน ${h.provinces} จังหวัด ไฟล์ใหม่จะแทนรายชื่อเดิมทั้งหมด` : ""}</p>
    <ul style="margin:0;padding-left:18px;color:var(--muted);font-size:.9rem;display:grid;gap:2px">
      <li>ต้องมีคอลัมน์ <b>รหัส 5 หลัก</b> (เช่น รหัส, hcode, hospcode) และ <b>ชื่อ</b> (เช่น ชื่อหน่วยบริการ, name)</li>
      <li>และคอลัมน์ <b>จังหวัด</b> เป็นชื่อหรือรหัสจังหวัด 2 หลัก (เช่น จังหวัด, changwat, chwpart) ถ้ามีคอลัมน์เขตจะใช้ด้วย</li>
      <li>รหัสที่ Excel ตัดเลข 0 หน้าออก (4835) ระบบเติมกลับเป็น 04835 ให้</li>
    </ul>
    <div class="field"><label for="ih-file">ไฟล์รายชื่อ</label><input id="ih-file" type="file" accept=".xlsx,.csv"></div>
    <div class="form-err" id="formErr"></div>
    <div id="ihResult"></div>
    <div class="sheet-actions"><button type="button" class="btn" data-close>ปิด</button><button class="btn primary" id="ihGo">นำเข้า</button></div>
  </div>`, true);
  sh.onclick = async (e) => {
    if (e.target.matches("[data-close]")) return closeSheet();
    if (e.target.id !== "ihGo") return;
    const f = $("#ih-file").files[0];
    if (!f) { $("#formErr").textContent = "เลือกไฟล์ก่อน"; return; }
    const btn = $("#ihGo");
    btn.disabled = true; btn.textContent = "กำลังนำเข้า…"; $("#formErr").textContent = "";
    try {
      const r = await api("POST", "/api/hospitals/import", undefined, new Blob([await f.arrayBuffer()], { type: "application/octet-stream" }));
      const m = r.matched;
      $("#ihResult").innerHTML = `<div class="verify">นำเข้า ${r.added.toLocaleString("th-TH")} แห่ง${r.badCode ? ` · ข้ามรหัสไม่ถูกต้อง ${r.badCode}` : ""}${r.noProvince ? ` · ไม่มีจังหวัด ${r.noProvince}` : ""}<br>
        จับคู่เคส: จากรหัส ${m.code} · จากชื่อ รพ.สต. ${m.name} · จากคอลัมน์จังหวัด ${m.province} · ประมาณจากช่องทางรับแจ้ง ${m.channel} · ไม่ทราบ ${m.none}</div>`;
      S.cases = null; S.freqCache = null;
      await loadCaseStats();
      searchCases(true);
      render();
    } catch (err) { $("#formErr").textContent = err.message; }
    btn.disabled = false; btn.textContent = "นำเข้า";
  };
}
function openImportCases() {
  const sh = openSheet(`<div class="sheet-panel">
    <h2>นำเข้าเคสจาก Excel</h2>
    <p style="margin:0;color:var(--muted)">เลือกไฟล์ .xlsx ที่ Export จากระบบรับแจ้งปัญหา (สรุปปัญหา รพ.สต.) ต้องมีคอลัมน์ "รายละเอียดปัญหา" และ "แนวทางการแก้ไข" ถ้ามีคอลัมน์ "สาเหตุ" ระบบจะเก็บด้วย</p>
    <ul style="margin:0;padding-left:18px;color:var(--muted);font-size:.9rem;display:grid;gap:2px">
      <li>เก็บเฉพาะเคสที่ปิดแล้วและมีวิธีแก้จริง</li>
      <li>ไม่เก็บชื่อผู้แจ้ง และลบเบอร์โทร, เลข AnyDesk, LINE ID ออกจากข้อความ</li>
      <li>นำเข้าไฟล์เดิมซ้ำได้ เคสที่มีอยู่แล้วจะไม่ถูกเพิ่มซ้ำ</li>
    </ul>
    <div class="field"><label for="ic-file">ไฟล์ Excel</label><input id="ic-file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"></div>
    <div class="form-err" id="formErr"></div>
    <div id="icResult"></div>
    <div class="sheet-actions"><button type="button" class="btn" data-close>ปิด</button><button class="btn primary" id="icGo">นำเข้า</button></div>
  </div>`, true);
  sh.onclick = async (e) => {
    if (e.target.matches("[data-close]")) return closeSheet();
    if (e.target.id !== "icGo") return;
    const f = $("#ic-file").files[0];
    if (!f) { $("#formErr").textContent = "เลือกไฟล์ก่อน"; return; }
    const btn = $("#icGo");
    btn.disabled = true;
    btn.textContent = "กำลังนำเข้า…";
    $("#formErr").textContent = "";
    try {
      const blob = new Blob([await f.arrayBuffer()], { type: "application/octet-stream" });
      const r = await api("POST", "/api/cases/import", undefined, blob);
      $("#icResult").innerHTML = `<div class="verify">
        อ่านได้ ${r.rows.toLocaleString("th-TH")} แถว · <b>เพิ่มใหม่ ${r.added.toLocaleString("th-TH")} เคส</b> · มีอยู่แล้ว ${r.duplicate.toLocaleString("th-TH")}<br>
        ข้าม: ยังไม่ปิดเคส ${r.notClosed} · ไม่มีวิธีแก้ที่ใช้ได้ ${r.noSolution} · ไม่มีรายละเอียดปัญหา ${r.noDetail}<br>
        ลบข้อมูลติดต่อออกจาก ${r.privacyRemoved} เคส${r.hasCause ? " · มีคอลัมน์สาเหตุ" : ""}</div>`;
      S.cases = null; S.freq = null; S.freqCache = null;
      await loadCaseStats();
      searchCases(true);
      render();
    } catch (err) { $("#formErr").textContent = err.message; }
    btn.disabled = false;
    btn.textContent = "นำเข้า";
  };
}

function select(id) {
  S.sel = id;
  history.replaceState(null, "", id ? "#" + encodeURIComponent(id) : location.pathname);
  renderList();
  renderDetail();
  if (id && matchMedia("(max-width:820px)").matches) scrollTo(0, 0);
}

/* ---------- sheets ---------- */
function openSheet(html, center) {
  const sh = $("#sheet");
  sh.className = "sheet" + (center ? " center" : "");
  sh.innerHTML = html;
  sh.hidden = false;
  return sh;
}
function closeSheet() {
  if (S.forcePw) return; // the new-password form cannot be dismissed
  const sh = $("#sheet");
  sh.hidden = true;
  sh.innerHTML = "";
  sh.onclick = null;
}
$("#sheet").addEventListener("mousedown", (e) => { if (e.target.id === "sheet") closeSheet(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#sheet").hidden) closeSheet(); });

function openLogin() {
  const sh = openSheet(`<form class="sheet-panel" id="loginForm" novalidate>
    <h2>เข้าสู่ระบบทีม</h2>
    <div class="field"><label for="l-user">ชื่อผู้ใช้</label><input id="l-user" autocomplete="username"></div>
    <div class="field"><label for="l-pass">รหัสผ่าน</label><input id="l-pass" type="password" autocomplete="current-password"></div>
    <div class="form-err" id="formErr"></div>
    <div class="sheet-actions"><button type="button" class="btn" data-close>ยกเลิก</button><button class="btn primary">เข้าสู่ระบบ</button></div>
  </form>`, true);
  $("#l-user").focus();
  sh.onclick = (e) => { if (e.target.matches("[data-close]")) closeSheet(); };
  $("#loginForm").onsubmit = async (e) => {
    e.preventDefault();
    try {
      S.me = (await api("POST", "/api/login", { username: $("#l-user").value, password: $("#l-pass").value })).user;
      closeSheet();
      if (S.me.mustChange) return openPassword(S.me, true);
      toast("เข้าสู่ระบบแล้ว");
      await load();
      await loadCaseStats();
      searchCases(true);
    } catch (err) { $("#formErr").textContent = err.message; }
  };
}

function openPassword(user = S.me, forced = false) {
  const self = user.id === S.me.id;
  S.forcePw = forced;
  const sh = openSheet(`<form class="sheet-panel" id="pwForm" novalidate>
    <h2>${forced ? "ตั้งรหัสผ่านของคุณ" : self ? "เปลี่ยนรหัสผ่าน" : "ตั้งรหัสผ่านใหม่ให้ " + esc(user.displayName)}</h2>
    ${forced ? `<div class="notice">บัญชี <b>${esc(user.username)}</b> ยังใช้รหัสผ่านที่ผู้อื่นตั้งให้ ตั้งรหัสผ่านใหม่ที่รู้คนเดียวก่อนใช้งาน</div>` : ""}
    ${!self ? '<div class="hint">เจ้าของบัญชีจะต้องตั้งรหัสใหม่เองเมื่อ Login ครั้งถัดไป</div>' : ""}
    <div class="field"><label for="p-new">รหัสผ่านใหม่</label><input id="p-new" type="password" autocomplete="new-password"><span class="hint">อย่างน้อย 8 ตัวอักษร</span></div>
    <div class="field"><label for="p-again">พิมพ์อีกครั้ง</label><input id="p-again" type="password" autocomplete="new-password"></div>
    <div class="form-err" id="formErr"></div>
    <div class="sheet-actions">${forced ? '<button type="button" class="btn" id="pwLogout">ออกจากระบบ</button>' : '<button type="button" class="btn" data-close>ยกเลิก</button>'}<button class="btn primary">บันทึก</button></div>
  </form>`, true);
  $("#p-new").focus();
  if (forced) $("#pwLogout").onclick = async () => {
    await api("POST", "/api/logout").catch(() => {});
    S.forcePw = false; S.me = null;
    closeSheet();
    load();
  };
  sh.onclick = (e) => { if (e.target.matches("[data-close]")) closeSheet(); };
  $("#pwForm").onsubmit = async (e) => {
    e.preventDefault();
    if ($("#p-new").value !== $("#p-again").value) { $("#formErr").textContent = "รหัสผ่านสองช่องไม่ตรงกัน"; return; }
    try {
      await api("PUT", `/api/users/${user.id}/password`, { password: $("#p-new").value });
      S.forcePw = false;
      closeSheet();
      toast("เปลี่ยนรหัสผ่านแล้ว");
      if (forced) {
        S.me.mustChange = 0;
        await load();
        await loadCaseStats();
        searchCases(true);
      }
    } catch (err) { $("#formErr").textContent = err.message; }
  };
}

async function openUsers() {
  let list = [];
  try { list = await api("GET", "/api/users"); } catch (err) { toast(err.message); return; }
  const sh = openSheet(`<div class="sheet-panel">
    <h2>จัดการผู้ใช้</h2>
    <div class="table-wrap"><table class="users"><thead><tr><th>ชื่อ</th><th>ชื่อผู้ใช้</th><th>สิทธิ์</th><th></th></tr></thead><tbody>
    ${list.map((u) => `<tr><td>${esc(u.displayName)}</td><td>${esc(u.username)}</td><td>${u.role === "admin" ? "ผู้ดูแลระบบ" : "ทีม"}</td>
      <td style="white-space:nowrap"><button class="btn small" data-pw="${u.id}">ตั้งรหัสใหม่</button> ${u.id !== S.me.id ? `<button class="btn small danger" data-del="${u.id}">ลบ</button>` : ""}</td></tr>`).join("")}
    </tbody></table></div>
    <div id="userConfirm"></div>
    <form id="newUser" class="cause-ed" novalidate>
      <div class="hd"><span>เพิ่มผู้ใช้ใหม่</span></div>
      <div class="row2">
        <div class="field"><label for="u-name">ชื่อที่แสดง</label><input id="u-name" placeholder="เช่น สมชาย ใจดี"></div>
        <div class="field"><label for="u-user">ชื่อผู้ใช้</label><input id="u-user" placeholder="เช่น somchai" autocomplete="off"></div>
      </div>
      <div class="row2">
        <div class="field"><label for="u-pass">รหัสผ่านเริ่มต้น</label><input id="u-pass" type="text" autocomplete="off"><span class="hint">อย่างน้อย 8 ตัว ให้เจ้าตัวเปลี่ยนเองภายหลัง</span></div>
        <div class="field"><label for="u-role">สิทธิ์</label><select id="u-role"><option value="team">ทีม (เพิ่ม/แก้ไขปัญหา)</option><option value="admin">ผู้ดูแลระบบ (+ จัดการผู้ใช้)</option></select></div>
      </div>
      <div class="form-err" id="formErr"></div>
      <button class="btn primary" style="justify-self:start">เพิ่มผู้ใช้</button>
    </form>
    <div class="sheet-actions"><button type="button" class="btn" data-close>ปิด</button></div>
  </div>`);
  sh.onclick = async (e) => {
    const t = e.target;
    if (t.matches("[data-close]")) return closeSheet();
    if (t.dataset.pw) return openPassword(list.find((u) => u.id === Number(t.dataset.pw)));
    if (t.dataset.del) {
      const u = list.find((x) => x.id === Number(t.dataset.del));
      $("#userConfirm").innerHTML = `<div class="notice" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">ลบบัญชี ${esc(u.displayName)}? <button class="btn small danger solid" data-delyes="${u.id}">ลบ</button><button class="btn small" data-delno>ยกเลิก</button></div>`;
      return;
    }
    if (t.matches("[data-delno]")) { $("#userConfirm").innerHTML = ""; return; }
    if (t.dataset.delyes) {
      try { await api("DELETE", "/api/users/" + t.dataset.delyes); toast("ลบผู้ใช้แล้ว"); openUsers(); }
      catch (err) { toast(err.message); }
    }
  };
  $("#newUser").onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api("POST", "/api/users", { displayName: $("#u-name").value, username: $("#u-user").value.trim(), password: $("#u-pass").value, role: $("#u-role").value });
      toast("เพิ่มผู้ใช้แล้ว");
      openUsers();
    } catch (err) { $("#formErr").textContent = err.message; }
  };
}

function openImport() {
  const sh = openSheet(`<div class="sheet-panel">
    <h2>นำเข้าข้อมูล</h2>
    <p style="margin:0;color:var(--muted)">เลือกไฟล์ JSON ที่ดาวน์โหลดจากเมนู "ดาวน์โหลดข้อมูลสำรอง" หรือไฟล์ที่ได้จากเวอร์ชันบน Claude เรื่องที่มีอยู่แล้ว (รหัสเดียวกัน) จะถูกอัปเดต เรื่องใหม่จะถูกเพิ่ม</p>
    <div class="field"><label for="imp-file">ไฟล์ JSON</label><input id="imp-file" type="file" accept=".json,application/json"></div>
    <div class="form-err" id="formErr"></div>
    <div id="impResult"></div>
    <div class="sheet-actions"><button type="button" class="btn" data-close>ปิด</button><button class="btn primary" id="impGo">นำเข้า</button></div>
  </div>`, true);
  sh.onclick = async (e) => {
    if (e.target.matches("[data-close]")) return closeSheet();
    if (e.target.id !== "impGo") return;
    const f = $("#imp-file").files[0];
    if (!f) { $("#formErr").textContent = "เลือกไฟล์ก่อน"; return; }
    try {
      const data = JSON.parse(await f.text());
      const r = await api("POST", "/api/import", data);
      $("#formErr").textContent = "";
      $("#impResult").innerHTML = `<div class="verify">เพิ่มใหม่ ${r.created} เรื่อง, อัปเดต ${r.updated} เรื่อง${r.skipped.length ? `<br>ข้าม ${r.skipped.length} เรื่อง: ${r.skipped.map(esc).join("; ")}` : ""}</div>`;
      load();
    } catch (err) { $("#formErr").textContent = err instanceof SyntaxError ? "ไฟล์ไม่ใช่ JSON ที่ถูกต้อง" : err.message; }
  };
}

/* ---------- editor ---------- */
function causeBlock(c = { cause: "", steps: [] }, i) {
  return `<div class="cause-ed" data-cause><div class="hd"><span>สาเหตุที่ ${i + 1}</span><button type="button" class="btn small danger" data-rm>ลบสาเหตุ</button></div>
    <div class="field"><input id="cause-${i}" placeholder="เช่น ไดรเวอร์เครื่องพิมพ์ค้าง" value="${esc(c.cause)}" data-c aria-label="ชื่อสาเหตุ"></div>
    <div class="field"><textarea id="steps-${i}" placeholder="ขั้นตอนแก้ไข บรรทัดละ 1 ขั้น" data-s aria-label="ขั้นตอนแก้ไข">${esc(c.steps.join("\n"))}</textarea><span class="hint">บรรทัดละ 1 ขั้นตอน ระบบจะใส่เลขลำดับให้</span></div></div>`;
}
function imgBlock(im) {
  return `<div class="img-ed" data-img="${esc(im.url)}"><img src="${esc(im.url)}" alt=""><input placeholder="คำอธิบายรูป เช่น หน้าตั้งค่าเครื่องพิมพ์" value="${esc(im.caption || "")}" aria-label="คำอธิบายรูป"><button type="button" class="btn small danger" data-rmimg>ลบ</button></div>`;
}
function openEditor(a, draft) {
  const isNew = !a;
  a = a || draft || { title: "", aliases: [], errorMsg: "", system: "HOSxP", level: "support", userVisible: false, causes: [{ cause: "", steps: [] }], verify: "", images: [] };
  const sysOpts = [...new Set([...SYSTEMS, a.system])].map((s) => `<option ${s === a.system ? "selected" : ""}>${esc(s)}</option>`).join("");
  const sh = openSheet(`<form class="sheet-panel" id="edForm" novalidate>
    <h2>${!isNew ? "แก้ไขปัญหา" : draft ? "สร้างบทความจากเคสเก่า" : "บันทึกปัญหาใหม่"}</h2>
    ${draft ? '<div class="notice">ดึงข้อความจากเคสเก่ามาให้แล้ว ตรวจและแก้ให้เป็นขั้นตอนที่ทำตามได้ ใส่สาเหตุ และแนบรูปหน้าจอถ้ามี ก่อนบันทึก</div>' : ""}
    <div class="field"><label for="f-title">ชื่อปัญหา / อาการ</label><input id="f-title" value="${esc(a.title)}" placeholder="เช่น พิมพ์สติกเกอร์ยาไม่ออก"></div>
    <div class="field"><label for="f-alias">คำที่ User มักแจ้ง</label><textarea id="f-alias" placeholder="บรรทัดละ 1 แบบ">${esc(a.aliases.join("\n"))}</textarea><span class="hint">ใส่หลายแบบช่วยให้ค้นเจอง่าย เช่น "ปริ้นไม่ออก", "สติกเกอร์ไม่มา"</span></div>
    <div class="field"><label for="f-err">ข้อความ Error (ถ้ามี)</label><textarea id="f-err" class="mono" placeholder="คัดลอกข้อความจากหน้าจอมาวาง">${esc(a.errorMsg)}</textarea></div>
    <div class="row2">
      <div class="field"><label for="f-sys">ระบบ</label><select id="f-sys">${sysOpts}</select></div>
      <div class="field"><label for="f-lv">ใครแก้ได้</label><select id="f-lv">${Object.entries(LEVELS).map(([k, v]) => `<option value="${k}" ${k === a.level ? "selected" : ""}>${v}</option>`).join("")}</select></div>
    </div>
    <label class="toggle"><input type="checkbox" id="f-uv" ${a.userVisible ? "checked" : ""}> เปิดให้ User เห็นเรื่องนี้ (อย่าเปิดถ้ามีขั้นตอนเกี่ยวกับ Database, Server หรือรหัสผ่าน)</label>
    <div class="field"><label>สาเหตุและขั้นตอนแก้ไข</label><div id="causes" style="display:grid;gap:10px">${a.causes.map(causeBlock).join("")}</div>
      <button type="button" class="btn" id="addCause" style="justify-self:start;margin-top:6px">+ เพิ่มสาเหตุ</button></div>
    <div class="field"><label for="f-img">รูปประกอบ</label>
      <div id="imgs" style="display:grid;gap:8px">${(a.images || []).map(imgBlock).join("")}</div>
      <div class="drop" id="drop">ลากรูปมาวาง, กด Ctrl+V เพื่อวางภาพหน้าจอ หรือ <label style="color:var(--accent);cursor:pointer;text-decoration:underline">เลือกไฟล์<input id="f-img" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden></label></div>
      <span class="hint">PNG, JPG, WEBP, GIF ไม่เกิน 5MB ต่อรูป</span></div>
    <div class="field"><label for="f-verify">ตรวจว่าแก้สำเร็จ</label><textarea id="f-verify" placeholder="เช่น สั่งพิมพ์ใบทดสอบจาก HOSxP แล้วออกครบ">${esc(a.verify)}</textarea></div>
    <div class="form-err" id="formErr"></div>
    <div class="sheet-actions"><button type="button" class="btn" data-close>ยกเลิก</button><button type="submit" class="btn primary" id="saveEd">บันทึก</button></div>
  </form>`);
  $("#f-title").focus();

  const renum = () => [...sh.querySelectorAll("[data-cause]")].forEach((el, i) => ($(".hd span", el).textContent = "สาเหตุที่ " + (i + 1)));
  let uploading = 0;
  async function upload(files) {
    for (const f of files) {
      if (!/^image\/(png|jpeg|webp|gif)$/.test(f.type)) { toast("รองรับเฉพาะ PNG, JPG, WEBP, GIF"); continue; }
      if (f.size > 5 * 1024 * 1024) { toast("รูปใหญ่เกิน 5MB"); continue; }
      uploading++;
      $("#saveEd").disabled = true;
      $("#drop").firstChild.textContent = "กำลังอัปโหลด… ";
      try {
        const r = await api("POST", "/api/uploads", undefined, f);
        $("#imgs").insertAdjacentHTML("beforeend", imgBlock({ url: r.url, caption: "" }));
      } catch (err) { toast(err.message); }
      if (--uploading === 0) { $("#saveEd").disabled = false; $("#drop").firstChild.textContent = "ลากรูปมาวาง, กด Ctrl+V เพื่อวางภาพหน้าจอ หรือ "; }
    }
  }
  $("#f-img").onchange = (e) => upload([...e.target.files]);
  const drop = $("#drop");
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); upload([...e.dataTransfer.files]); };
  sh.onpaste = (e) => {
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith("image/"));
    if (files.length) { e.preventDefault(); upload(files); }
  };

  sh.onclick = (e) => {
    const t = e.target;
    if (t.matches("[data-close]")) return closeSheet();
    if (t.id === "addCause") { $("#causes").insertAdjacentHTML("beforeend", causeBlock(undefined, sh.querySelectorAll("[data-cause]").length)); return; }
    if (t.matches("[data-rm]")) { t.closest("[data-cause]").remove(); renum(); return; }
    if (t.matches("[data-rmimg]")) t.closest("[data-img]").remove();
  };
  $("#edForm").onsubmit = async (e) => {
    e.preventDefault();
    if (uploading) return;
    const lines = (v) => v.split("\n").map((s) => s.trim()).filter(Boolean);
    const causes = [...sh.querySelectorAll("[data-cause]")]
      .map((el) => ({ cause: $("[data-c]", el).value.trim(), steps: lines($("[data-s]", el).value) }))
      .filter((c) => c.cause || c.steps.length);
    const body = {
      title: $("#f-title").value.trim(), aliases: lines($("#f-alias").value), errorMsg: $("#f-err").value.trim(),
      system: $("#f-sys").value, level: $("#f-lv").value, userVisible: $("#f-uv").checked, causes, verify: $("#f-verify").value.trim(),
      images: [...sh.querySelectorAll("[data-img]")].map((el) => ({ url: el.dataset.img, caption: $("input", el).value.trim() })),
      example: false,
    };
    if (!body.title) { $("#formErr").textContent = "ใส่ชื่อปัญหาก่อนบันทึก"; return; }
    if (!causes.length || causes.some((c) => !c.cause || !c.steps.length)) { $("#formErr").textContent = "แต่ละสาเหตุต้องมีชื่อสาเหตุและขั้นตอนแก้ไขอย่างน้อย 1 ขั้น"; return; }
    $("#saveEd").disabled = true;
    try {
      const saved = isNew ? await api("POST", "/api/articles", body) : await api("PUT", "/api/articles/" + encodeURIComponent(a.id), body);
      closeSheet();
      toast("บันทึกแล้ว");
      S.sel = saved.id;
      S.tab = "articles";
      await load();
      select(saved.id);
    } catch (err) {
      $("#saveEd").disabled = false;
      $("#formErr").textContent = err.status === 401 ? "หมดเวลาเข้าสู่ระบบ กรุณาเข้าสู่ระบบใหม่ (ข้อมูลในฟอร์มยังอยู่)" : err.message;
    }
  };
}

/* ---------- events ---------- */
$("#q").addEventListener("input", (e) => {
  S.q = e.target.value;
  if (S.tab === "frequent" && S.q.trim()) { S.tab = "cases"; render(); }
  if (S.tab === "articles") renderList();
  renderHeader();
  searchCases();
});
$("#userView").addEventListener("change", (e) => { S.userView = e.target.checked; render(); });
$("#filters").addEventListener("click", (e) => { const b = e.target.closest("[data-sys]"); if (!b) return; S.sys = b.dataset.sys; render(); });
$("#list").addEventListener("click", (e) => { const b = e.target.closest(".item"); if (b) select(b.dataset.id); });
$("#loginBtn").addEventListener("click", openLogin);
$("#addBtn").addEventListener("click", () => openEditor());

$("#acctBtn").addEventListener("click", (e) => {
  e.stopPropagation();
  const l = $("#acctList");
  l.hidden = !l.hidden;
  $("#acctBtn").setAttribute("aria-expanded", String(!l.hidden));
});
document.addEventListener("click", () => { $("#acctList").hidden = true; $("#acctBtn").setAttribute("aria-expanded", "false"); });
$("#mPassword").addEventListener("click", () => openPassword());
$("#mUsers").addEventListener("click", openUsers);
$("#mImport").addEventListener("click", openImport);
$("#mImportCases").addEventListener("click", openImportCases);
$("#mSync").addEventListener("click", openSync);
$("#mImportHosp").addEventListener("click", openImportHospitals);
$("#mExport").addEventListener("click", () => { if (window.KB_DEMO) return window.KB_DEMO.exportJson(); location.href = "/api/export"; });
$("#mLogout").addEventListener("click", async () => {
  await api("POST", "/api/logout").catch(() => {});
  S.me = null; S.userView = false; S.tab = "articles"; S.cases = null; S.freq = null; S.freqCache = null; S.caseStats = null;
  toast("ออกจากระบบแล้ว");
  load();
});

/* ---------- image viewer: opens in the page (a data: image cannot open in a new tab) ---------- */
function openViewer(images, i) {
  const v = document.createElement("div");
  v.className = "viewer";
  v.setAttribute("role", "dialog");
  v.setAttribute("aria-label", "ดูรูปขนาดใหญ่");
  const draw = () => {
    const im = images[i];
    v.innerHTML = `<img src="${esc(im.url)}" alt="${esc(im.caption || "")}">
      ${im.caption ? `<div class="viewer-cap">${esc(im.caption)}</div>` : ""}
      <div class="viewer-bar">${images.length > 1 ? `<button data-v="-1" aria-label="รูปก่อนหน้า">‹</button><span>${i + 1} / ${images.length}</span><button data-v="1" aria-label="รูปถัดไป">›</button>` : ""}<button data-v="x">ปิด (Esc)</button></div>`;
  };
  const close = () => { v.remove(); removeEventListener("keydown", key, true); };
  const step = (d) => { i = (i + d + images.length) % images.length; draw(); };
  const key = (e) => {
    if (e.key === "Escape") { e.stopPropagation(); close(); }
    if (e.key === "ArrowLeft") step(-1);
    if (e.key === "ArrowRight") step(1);
  };
  v.addEventListener("click", (e) => {
    const b = e.target.closest("[data-v]");
    if (b) return b.dataset.v === "x" ? close() : step(Number(b.dataset.v));
    if (e.target === v) close();
  });
  addEventListener("keydown", key, true);
  draw();
  document.body.append(v);
  v.querySelector("[data-v='x']").focus();
}

$("#detail").addEventListener("click", async (e) => {
  const z = e.target.closest("[data-zoom]");
  if (z) {
    const a = S.articles.find((x) => x.id === S.sel);
    if (a?.images?.length) { e.preventDefault(); openViewer(a.images, Number(z.dataset.zoom)); }
    return;
  }
  const a = S.articles.find((x) => x.id === S.sel);
  if (!a) return;
  const id = e.target.id;
  if (id === "backBtn") return select(null);
  if (id === "copyErr" || id === "linkBtn") {
    const text = id === "copyErr" ? a.errorMsg : location.origin + location.pathname + "#" + encodeURIComponent(a.id);
    try { await navigator.clipboard.writeText(text); toast("คัดลอกแล้ว"); }
    catch { prompt("คัดลอกข้อความนี้", text); }
    return;
  }
  if (id === "editBtn") return openEditor(a);
  if (id === "delBtn") {
    $("#delConfirm").innerHTML = `<div class="notice" style="margin-top:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">ลบเรื่องนี้ออกจากคลัง? (ผู้ดูแลระบบกู้คืนจากประวัติในฐานข้อมูลได้) <button class="btn small danger solid" id="delYes">ลบ</button><button class="btn small" id="delNo">ยกเลิก</button></div>`;
    return;
  }
  if (id === "delNo") { $("#delConfirm").innerHTML = ""; return; }
  if (id === "delYes") {
    try { await api("DELETE", "/api/articles/" + encodeURIComponent(a.id)); toast("ลบแล้ว"); S.sel = null; load(); }
    catch (err) { toast(err.message); }
    return;
  }
  if (id === "fbUp" || id === "fbDown") {
    const val = id === "fbUp" ? 1 : -1;
    try {
      a.feedback = await api("POST", `/api/articles/${encodeURIComponent(a.id)}/feedback`, { value: a.feedback.mine === val ? 0 : val });
      renderDetail();
    } catch (err) { toast(err.message); }
  }
});

window.addEventListener("hashchange", () => {
  const id = decodeURIComponent(location.hash.slice(1));
  if (id !== S.sel && S.articles.some((a) => a.id === id)) select(id);
});
// refresh when the tab comes back into focus, so edits by teammates show up
let lastLoad = Date.now();
window.addEventListener("focus", () => { if (Date.now() - lastLoad > 30e3 && $("#sheet").hidden) { lastLoad = Date.now(); load(); } });

/* ---------- theme: ตามระบบ → สว่าง → มืด ---------- */
const THEMES = {
  system: { label: "ตามระบบ", next: "light", icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>' },
  light: { label: "สว่าง", next: "dark", icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>' },
  dark: { label: "มืด", next: "system", icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>' },
};
function currentTheme() { return document.documentElement.dataset.theme || "system"; }
function applyTheme(t) {
  if (t === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  try { t === "system" ? localStorage.removeItem("kb-theme") : localStorage.setItem("kb-theme", t); } catch {}
  const th = THEMES[t], btn = $("#themeBtn");
  btn.innerHTML = th.icon + `<span>${th.label}</span>`;
  btn.title = `ธีม: ${th.label} (กดเพื่อเปลี่ยนเป็น${THEMES[th.next].label})`;
  btn.setAttribute("aria-label", btn.title);
}
$("#themeBtn").addEventListener("click", () => applyTheme(THEMES[currentTheme()].next));
applyTheme(currentTheme());

/* ---------- boot ---------- */
(async () => {
  render();
  await loadMe();
  if (S.me?.mustChange) { render(); return openPassword(S.me, true); }
  await load();
  if (isTeam()) { await loadCaseStats(); searchCases(true); }
  const id = decodeURIComponent(location.hash.slice(1));
  if (id && S.articles.some((a) => a.id === id)) select(id);
})();

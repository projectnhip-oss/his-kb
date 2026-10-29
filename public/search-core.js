// ค้นหาเคสคล้ายกัน และจัดกลุ่มปัญหาที่พบบ่อย ใช้ทั้งฝั่ง Server (cases.js) และเวอร์ชันทดลองบน GitHub Pages
(function (root) {
  const norm = typeof module !== "undefined" && module.exports ? require("./norm.js") : root.kbNorm;

function grams(s) {
  const t = s.replace(/\s/g, "");
  const out = new Set();
  if (t.length < 3) { if (t) out.add(t); return out; }
  for (let i = 0; i <= t.length - 3; i++) out.add(t.slice(i, i + 3));
  return out;
}
function overlap(a, b) {
  let n = 0;
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  for (const g of small) if (big.has(g)) n++;
  return n;
}

const FILLER = /พี่|เจ้าหน้าที่|จนท\.?|แจ้ง|ว่า|สามารถ|เข้า|ใช้งาน|ใช้|ได้|ปกติ|แล้ว|ค่ะ|ครับ|คะ|โทร|ติดตาม|เมื่อ|ไป|ตรวจสอบ|พบ|ทำการ|ผู้|เรียบร้อย|ดำเนินการ|ทาง|ระบบ|โปรแกรม|\s|[.\-,]/g;
const isThin = (sol) => String(sol || "").replace(/เเ/g, "แ").replace(FILLER, "").length < 12;

/* ---------- in-memory search index ---------- */
/** rows: case records, newest first (snake_case columns as stored). */
function makeIndex(rows) {
  return rows.map((c) => {
    const nd = norm(c.detail), ns = norm(c.cause + " " + c.solution);
    return { c, nd, ns, gd: grams(nd), gs: grams(ns), thin: isThin(c.solution), solKey: ns.replace(/\s/g, "").slice(0, 80) };
  });
}
const view = (x, score) => ({
  id: x.c.id, caseNo: x.c.case_no, date: x.c.date, project: x.c.project, unit: x.c.unit, province: x.c.province,
  detail: x.c.detail, cause: x.c.cause, solution: x.c.solution, solver: x.c.solver, duration: x.c.duration,
  type: x.c.type, solKey: x.solKey,
  hcode: x.c.hcode, hname: x.c.hname, prov: x.c.prov, region: x.c.region, locSrc: x.c.loc_src, score: score == null ? undefined : Math.round(score * 100) / 100,
});

/** Area filter: { region: 1..13, prov: "น่าน" } or { unknown: true } for cases with no place. */
/** Filter: { project: "คลาวด์กลาง", region: 1..13, prov: "น่าน" } or { unknown: true } for cases with no place. */
function areaFilter(f = {}) {
  const region = Number(f.region) || 0, prov = f.prov || "", project = f.project || "";
  let place = null;
  if (f.unknown) place = (x) => !x.c.prov;
  else if (prov) place = (x) => x.c.prov === prov;
  else if (region) place = (x) => x.c.region === region;
  if (!project) return place;
  return place ? (x) => x.c.project === project && place(x) : (x) => x.c.project === project;
}
function search(all, q, limit = 50, f = {}) {
  const pass = areaFilter(f);
  const idx = pass ? all.filter(pass) : all;
  const nq = norm(q);
  if (!nq) return { total: idx.length, results: idx.slice(0, limit).map((x) => view(x)) };
  const gq = grams(nq);
  const words = nq.split(" ").filter((w) => w.length >= 2);
  const scored = [];
  for (const x of idx) {
    const inD = overlap(gq, x.gd), inS = overlap(gq, x.gs);
    if (!inD && !inS) continue;
    const contain = inD / gq.size; // how much of the query appears in the problem text
    const dice = (2 * inD) / (gq.size + x.gd.size); // how close the two texts are overall
    const solHit = inS / gq.size; // the query may name the fix (e.g. "token")
    let score = 0.6 * contain + 0.3 * dice + 0.25 * solHit;
    if (words.length && words.every((w) => x.nd.includes(w) || x.ns.includes(w))) score += 0.15;
    if (x.thin) score -= 0.25;
    if (score >= 0.35) scored.push([score, x]);
  }
  scored.sort((a, b) => b[0] - a[0] || (b[1].c.date || "").localeCompare(a[1].c.date || ""));
  return { total: scored.length, results: scored.slice(0, limit).map(([s, x]) => view(x, s)) };
}

/* ---------- frequent problems ---------- */
const addDays = (iso, n) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * Group similar problems and rank them by how often they were reported.
 * days > 0 looks back from the newest case in the data (not from today, since the
 * export may be a few days old) and also counts the window before it, to show the trend.
 */
function buildFrequent(every, days, pass) {
  // the date window comes from all data, so every area is measured over the same days
  const last = every.reduce((m, x) => (x.c.date && x.c.date > m ? x.c.date : m), "");
  const first = every.reduce((m, x) => (x.c.date && (!m || x.c.date < m) ? x.c.date : m), "");
  const all = pass ? every.filter(pass) : every;
  let from = null, prevFrom = null;
  if (days && last) {
    from = addDays(last, -(days - 1));
    prevFrom = addDays(from, -days);
  }
  const inWin = (x) => !from || (x.c.date && x.c.date >= from);
  const inPrev = (x) => prevFrom && x.c.date && x.c.date >= prevFrom && x.c.date < from;
  const idx = from ? all.filter((x) => inWin(x) || inPrev(x)) : all;

  const clusters = [];
  const byGram = new Map(); // 3-letter chunk → groups whose wording has it, so we only compare groups that share text
  for (const x of [...idx].sort((a, b) => a.nd.length - b.nd.length)) {
    if (x.gd.size < 2) continue;
    const shared = new Map();
    for (const g of x.gd) for (const cl of byGram.get(g) || []) shared.set(cl, (shared.get(cl) || 0) + 1);
    let best = null, bestSim = 0;
    for (const [cl, n] of shared) {
      const dice = (2 * n) / (x.gd.size + cl.g.size);
      // the group's short wording appears inside a longer report:
      // "ตรวจสอบสิทธิ์ไม่ได้ค่ะ" ⊂ "ตรวจสอบสิทธิไม่ได้ ขึ้นเลขบัตรไม่ถูกต้อง"
      const within = cl.g.size >= 4 ? n / cl.g.size : 0;
      const sim = Math.max(dice, within >= 0.8 ? within * 0.7 : 0);
      if (sim > bestSim) { bestSim = sim; best = cl; }
    }
    if (best && bestSim >= 0.55) best.items.push(x);
    else {
      const cl = { g: x.gd, items: [x] };
      clusters.push(cl);
      for (const g of x.gd) {
        if (!byGram.has(g)) byGram.set(g, []);
        byGram.get(g).push(cl);
      }
    }
  }
  const minCount = days && days <= 15 ? 2 : 3;
  const withNow = clusters.map((cl) => ({ ...cl, now: cl.items.filter(inWin), prev: cl.items.filter(inPrev).length }));
  // reported too few times to be a pattern, but the team may still want to see them and their fix
  const singles = withNow
    .filter((cl) => cl.now.length && cl.now.length < minCount)
    .flatMap((cl) => cl.now)
    .concat(idx.filter((x) => x.gd.size < 2 && inWin(x)))
    .sort((a, b) => (b.c.date || "").localeCompare(a.c.date || "") || a.thin - b.thin);
  const groups = withNow
    .filter((cl) => cl.now.length >= minCount)
    .sort((a, b) => b.now.length - a.now.length || b.prev - a.prev)
    .map((cl) => {
      const sols = new Map();
      for (const x of cl.items) {
        if (x.thin) continue;
        const s = sols.get(x.solKey) || { text: x.c.solution, n: 0 };
        s.n++;
        sols.set(x.solKey, s);
      }
      // the wording people used in this window names the group; fixes come from all its cases
      const det = new Map();
      for (const x of cl.now) det.set(x.c.detail, (det.get(x.c.detail) || 0) + 1);
      const sample = [...det.entries()].sort((a, b) => b[1] - a[1]);
      return {
        title: sample[0][0],
        variants: sample.slice(1, 5).map((e) => e[0]),
        count: cl.now.length,
        prevCount: from ? cl.prev : null,
        lastDate: cl.now.map((x) => x.c.date).sort().pop(),
        solutions: [...sols.values()].sort((a, b) => b.n - a.n).slice(0, 3),
        types: [...new Set(cl.now.map((x) => x.c.type).filter(Boolean))].slice(0, 3),
      };
    });
  return {
    days, from, to: last || null,
    // the trend is only fair when the data reaches back over the whole previous window
    prevComplete: !!(from && first && first <= prevFrom),
    prevFrom,
    totalInWindow: all.filter(inWin).length,
    groups,
    totalSingles: singles.length,
    singles: singles.slice(0, 60).map((x) => view(x)),
  };
}


  const api = { grams, overlap, FILLER, isThin, makeIndex, view, areaFilter, search, buildFrequent };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.kbCore = api;
})(this);

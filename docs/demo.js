// เวอร์ชันทดลองบน GitHub Pages: ตอบคำขอ /api/... แทน Server ในเบราว์เซอร์
// ข้อมูลที่แก้ (บทความ ผู้ใช้ คะแนน) เก็บในเบราว์เซอร์ของแต่ละคนเท่านั้น ไม่มีใครเห็นของกันและกัน
(function () {
  const KEY = "kb-demo-v1";
  const SEED_ARTICLES = window.KB_DEMO_ARTICLES || [];
  const core = window.kbCore;
  const index = core.makeIndex(window.KB_DEMO_CASES || []);

  const blank = () => ({
    articles: SEED_ARTICLES.map((a) => ({ ...a, createdAt: a.createdAt || new Date().toISOString(), updatedAt: a.updatedAt || new Date().toISOString() })),
    feedback: {}, // articleId -> value of this browser (1 / -1)
    users: [
      { id: 1, username: "admin", displayName: "ผู้ดูแลระบบ (ทดลอง)", role: "admin", password: "admin" },
      { id: 2, username: "team", displayName: "ทีม Support (ทดลอง)", role: "team", password: "team1234" },
    ],
    me: null,
  });
  let st;
  try { st = JSON.parse(localStorage.getItem(KEY)) || blank(); } catch { st = blank(); }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* storage full or blocked */ } };

  const fail = (status, error) => { throw Object.assign(new Error(error), { status }); };
  const me = () => st.users.find((u) => u.id === st.me) || null;
  const pub = (u) => u && { id: u.id, username: u.username, displayName: u.displayName, role: u.role };
  const needTeam = () => me() || fail(401, "กรุณาเข้าสู่ระบบ");
  const needAdmin = () => (me()?.role === "admin" ? me() : fail(403, "เฉพาะผู้ดูแลระบบ"));
  const off = () => fail(400, "ใช้ไม่ได้ในเวอร์ชันทดลอง ฟังก์ชันนี้ต้องใช้ Server จริง");

  function clean(a) {
    const list = (v) => (Array.isArray(v) ? v : []).map((x) => String(x || "").trim()).filter(Boolean);
    const out = {
      title: String(a.title || "").trim(), aliases: list(a.aliases), errorMsg: String(a.errorMsg || "").trim(),
      system: String(a.system || "อื่นๆ"), level: ["user", "support", "escalate"].includes(a.level) ? a.level : "support",
      userVisible: !!a.userVisible, verify: String(a.verify || "").trim(), example: !!a.example,
      causes: (a.causes || []).map((c) => ({ cause: String(c.cause || "").trim(), steps: list(c.steps) })).filter((c) => c.cause || c.steps.length),
      images: (a.images || []).filter((i) => i && i.url),
      projects: [...new Set(list(a.projects))],
    };
    if (!out.title) fail(400, "ต้องมีชื่อปัญหา");
    if (!out.causes.length || out.causes.some((c) => !c.cause || !c.steps.length)) fail(400, "แต่ละสาเหตุต้องมีชื่อและขั้นตอนอย่างน้อย 1 ขั้น");
    return out;
  }
  const withMeta = (a) => {
    const v = st.feedback[a.id] || 0;
    const base = a.demoVotes || { up: 0, down: 0 };
    const u = st.users.find((x) => String(x.id) === String(a.updatedBy));
    return { ...a, updatedByName: u ? u.displayName : null, feedback: { up: base.up + (v === 1), down: base.down + (v === -1), mine: v } };
  };
  const area = (p) => ({ region: Number(p.get("region")) || 0, prov: p.get("prov") || "", unknown: p.get("area") === "unknown", project: p.get("project") || "" });
  const readFile = (blob) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(blob); });

  const freqCache = {};
  async function handle(method, url, body, raw) {
    const u = new URL(url, location.href);
    const p = u.pathname.replace(/^.*\/api\//, "/api/");
    const q = u.searchParams;
    let m;

    if (p === "/api/me") return { user: pub(me()) };
    if (p === "/api/login" && method === "POST") {
      const x = st.users.find((z) => z.username === String(body?.username || "").trim() && z.password === body?.password);
      if (!x) fail(401, "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง");
      st.me = x.id; save();
      return { user: pub(x) };
    }
    if (p === "/api/logout") { st.me = null; save(); return { ok: true }; }

    if (p === "/api/articles" && method === "GET") return st.articles.filter((a) => me() || a.userVisible).map(withMeta);
    if (p === "/api/articles" && method === "POST") {
      const user = needTeam();
      const now = new Date().toISOString();
      const a = { ...clean(body), id: "a" + Date.now().toString(36), createdAt: now, updatedAt: now, updatedBy: String(user.id) };
      st.articles.push(a); save();
      return a;
    }
    if ((m = p.match(/^\/api\/articles\/([^/]+)\/feedback$/))) {
      const id = decodeURIComponent(m[1]);
      const a = st.articles.find((x) => x.id === id) || fail(404, "ไม่พบเรื่องนี้");
      st.feedback[id] = Number(body?.value) || 0; save();
      return withMeta(a).feedback;
    }
    if ((m = p.match(/^\/api\/articles\/([^/]+)$/))) {
      const user = needTeam();
      const i = st.articles.findIndex((x) => x.id === decodeURIComponent(m[1]));
      if (i < 0) fail(404, "ไม่พบเรื่องนี้");
      if (method === "DELETE") { st.articles.splice(i, 1); save(); return { ok: true }; }
      st.articles[i] = { ...st.articles[i], ...clean(body), updatedAt: new Date().toISOString(), updatedBy: String(user.id) };
      save();
      return st.articles[i];
    }
    if (p === "/api/uploads") {
      needTeam();
      if (raw.size > 1.5 * 1024 * 1024) fail(400, "เวอร์ชันทดลองรับรูปไม่เกิน 1.5MB");
      return { url: await readFile(raw) };
    }

    if (p === "/api/cases/stats") {
      needTeam();
      const d = index.map((x) => x.c.date).sort();
      return { n: index.length, first: d[0], last: d[d.length - 1], importedAt: null };
    }
    if (p === "/api/cases/facets") {
      needTeam();
      const R = new Map(), P = new Map(), J = new Map();
      for (const x of index) J.set(x.c.project, (J.get(x.c.project) || 0) + 1);
      const proj = q.get("project") || "";
      const sub = proj ? index.filter((x) => x.c.project === proj) : index;
      for (const x of sub) {
        R.set(x.c.region, (R.get(x.c.region) || 0) + 1);
        const k = x.c.prov;
        P.set(k, { prov: k, region: x.c.region, n: (P.get(k)?.n || 0) + 1 });
      }
      return {
        regions: [...R].sort((a, b) => a[0] - b[0]).map(([region, n]) => ({ region, n })),
        provinces: [...P.values()].sort((a, b) => a.region - b.region || b.n - a.n),
        total: sub.length, projects: [...J].sort((a, b) => b[1] - a[1]).map(([project, n]) => ({ project, n })),
        how: [], hospitals: { n: 1, provinces: 0 }, // demo: hide the "import a hospital list" hint
      };
    }
    if (p === "/api/cases/search") { needTeam(); return core.search(index, q.get("q") || "", Number(q.get("limit")) || 50, area(q)); }
    if (p === "/api/cases/frequent") {
      needTeam();
      const days = Number(q.get("days")) || 0, f = area(q);
      const key = [days, f.region, f.prov, f.unknown, f.project].join("|");
      const r = (freqCache[key] ||= core.buildFrequent(index, days, core.areaFilter(f)));
      const limit = Number(q.get("limit")) || 40;
      return { ...r, totalGroups: r.groups.length, groups: r.groups.slice(0, limit) };
    }

    if (p === "/api/users" && method === "GET") { needAdmin(); return st.users.map(pub); }
    if (p === "/api/users" && method === "POST") {
      needAdmin();
      if (!/^[a-zA-Z0-9._-]{3,30}$/.test(body?.username || "")) fail(400, "ชื่อผู้ใช้ใช้ a-z, 0-9, . _ - ยาว 3-30 ตัว");
      if (String(body?.password || "").length < 8) fail(400, "รหัสผ่านต้องยาวอย่างน้อย 8 ตัว");
      if (st.users.some((x) => x.username === body.username)) fail(409, "มีชื่อผู้ใช้นี้แล้ว");
      const x = { id: Math.max(...st.users.map((z) => z.id)) + 1, username: body.username, displayName: body.displayName || body.username, role: body.role === "admin" ? "admin" : "team", password: body.password };
      st.users.push(x); save();
      return pub(x);
    }
    if ((m = p.match(/^\/api\/users\/(\d+)\/password$/))) {
      const user = needTeam();
      const x = st.users.find((z) => z.id === Number(m[1])) || fail(404, "ไม่พบผู้ใช้");
      if (user.role !== "admin" && user.id !== x.id) fail(403, "เปลี่ยนได้เฉพาะรหัสของตัวเอง");
      if (String(body?.password || "").length < 8) fail(400, "รหัสผ่านต้องยาวอย่างน้อย 8 ตัว");
      x.password = body.password; save();
      return { ok: true };
    }
    if ((m = p.match(/^\/api\/users\/(\d+)$/)) && method === "DELETE") {
      const user = needAdmin();
      if (Number(m[1]) === user.id) fail(400, "ลบบัญชีของตัวเองไม่ได้");
      st.users = st.users.filter((z) => z.id !== Number(m[1])); save();
      return { ok: true };
    }

    if (p === "/api/sync" && method === "GET") { needTeam(); return { hasToken: false, interval: 60, url: "", lastStatus: null }; }
    if (p.startsWith("/api/sync") || p.endsWith("/import")) off();
    fail(404, "ไม่พบ API นี้");
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(st.articles, null, 2)], { type: "application/json" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "his-kb-demo.json" });
    document.body.append(a); a.click(); a.remove();
  }
  function reset() { try { localStorage.removeItem(KEY); } catch {} location.reload(); }

  window.KB_DEMO = { api: (...a) => handle(...a), exportJson, reset };

  // banner so nobody mistakes the preview for the real system
  addEventListener("DOMContentLoaded", () => {
    const b = document.createElement("div");
    b.className = "demo-banner";
    b.innerHTML = 'เวอร์ชันทดลอง: ข้อมูลเคสเป็นตัวอย่างที่แต่งขึ้น สิ่งที่บันทึกจะเก็บเฉพาะในเบราว์เซอร์นี้ · Login: <b>admin / admin</b> หรือ <b>team / team1234</b> <button type="button">ล้างข้อมูลทดลอง</button>';
    b.querySelector("button").onclick = reset;
    document.body.prepend(b);
  });
})();

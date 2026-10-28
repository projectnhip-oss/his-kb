const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const { DATA_DIR, articles, users, sessions, cleanArticle, checkPassword } = require("./db");
const cases = require("./cases");
require("./locations").applyLocations(); // cases imported by an older version get their area too

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const IMG_TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };

/* ---------- first run ---------- */
// บัญชีตั้งต้นที่ใช้ร่วมกันทั้งทีม: admin / admin (เปลี่ยนได้ด้วย DEFAULT_ADMIN_PASSWORD)
if (users.count() === 0) {
  const pw = process.env.DEFAULT_ADMIN_PASSWORD || "admin";
  users.create("admin", "ผู้ดูแลระบบ", pw, "admin", 1);
  console.log(`สร้างบัญชีตั้งต้นแล้ว  ชื่อผู้ใช้: admin  รหัสผ่าน: ${pw}  (ต้องตั้งรหัสใหม่เมื่อ Login ครั้งแรก)`);
}
if (articles.list(true).length === 0) {
  const seedFile = path.join(__dirname, "seed-data.json");
  if (fs.existsSync(seedFile)) {
    const seed = JSON.parse(fs.readFileSync(seedFile, "utf8"));
    for (const item of seed) {
      const { article } = cleanArticle(item);
      articles.create(article, null, { id: item.id, createdAt: item.createdAt, updatedAt: item.updatedAt });
    }
    console.log(`ใส่ข้อมูลตัวอย่าง ${seed.length} เรื่อง`);
  }
}
sessions.purge();
setInterval(() => sessions.purge(), 6 * 3600e3).unref();

/* ---------- app ---------- */
const app = express();
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Referrer-Policy": "same-origin",
  });
  next();
});

function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function setCookie(res, name, value, maxAgeMs) {
  const secure = process.env.COOKIE_SECURE === "1" ? "; Secure" : "";
  res.append("Set-Cookie", `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}${secure}`);
}

// who is calling + an anonymous voter id for feedback
app.use((req, res, next) => {
  const c = cookies(req);
  req.token = c.kbs;
  req.user = sessions.user(c.kbs);
  if (req.user) req.voter = "u:" + req.user.id;
  else {
    let v = c.kbv;
    if (!v || !/^[a-f0-9]{32}$/.test(v)) {
      v = crypto.randomBytes(16).toString("hex");
      setCookie(res, "kbv", v, 365 * 864e5);
    }
    req.voter = "a:" + v;
  }
  next();
});

// anyone still on a well-known password must change it before using anything else
for (const u of users.all()) if (checkPassword("admin", u.pass_hash)) users.flagMustChange(u.id);
app.use("/api", (req, res, next) => {
  if (!req.user?.mustChange) return next();
  const own = req.method === "PUT" && req.path === `/users/${req.user.id}/password`;
  if (own || req.path === "/me" || req.path === "/logout") return next();
  res.status(403).json({ error: "กรุณาเปลี่ยนรหัสผ่านก่อนใช้งาน", mustChange: true });
});

// write requests must come from our own page (blocks cross-site form posts)
app.use("/api", (req, res, next) => {
  if (req.method !== "GET" && req.get("X-KB") !== "1") return res.status(403).json({ error: "คำขอไม่ถูกต้อง" });
  next();
});

const needTeam = (req, res, next) => (req.user ? next() : res.status(401).json({ error: "กรุณาเข้าสู่ระบบ" }));
const needAdmin = (req, res, next) =>
  req.user?.role === "admin" ? next() : res.status(403).json({ error: "เฉพาะผู้ดูแลระบบ" });

/* ---------- auth ---------- */
const attempts = new Map();
app.post("/api/login", express.json(), (req, res) => {
  // behind Cloudflare Tunnel every request arrives from 127.0.0.1: count tries per real visitor
  const key = req.get("cf-connecting-ip") || req.ip;
  const a = attempts.get(key) || { n: 0, until: 0 };
  if (a.until > Date.now()) return res.status(429).json({ error: "ลองผิดหลายครั้ง รอ 5 นาทีแล้วลองใหม่" });
  const { username, password } = req.body || {};
  const u = users.byUsername(String(username || "").trim());
  if (!u || !checkPassword(String(password || ""), u.pass_hash)) {
    a.n++;
    if (a.n >= 5) Object.assign(a, { n: 0, until: Date.now() + 5 * 60e3 });
    attempts.set(key, a);
    return res.status(401).json({ error: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" });
  }
  attempts.delete(key);
  const s = sessions.create(u.id);
  setCookie(res, "kbs", s.token, s.maxAge);
  res.json({ user: users.get(u.id) });
});
app.post("/api/logout", (req, res) => {
  if (req.token) sessions.destroy(req.token);
  setCookie(res, "kbs", "", 0);
  res.json({ ok: true });
});
app.get("/api/me", (req, res) => res.json({ user: req.user }));

/* ---------- articles ---------- */
app.get("/api/articles", (req, res) => {
  const list = articles.list(!!req.user);
  const fb = articles.feedbackSummary(req.voter);
  const names = Object.fromEntries(users.list().map((u) => [String(u.id), u.displayName]));
  res.json(
    list.map((a) => ({
      ...a,
      updatedByName: a.updatedBy ? names[a.updatedBy] || null : null,
      feedback: fb[a.id] || { up: 0, down: 0, mine: 0 },
    }))
  );
});

app.post("/api/articles", needTeam, express.json({ limit: "1mb" }), (req, res) => {
  const { article, errors } = cleanArticle(req.body);
  if (errors.length) return res.status(400).json({ error: errors.join(", ") });
  res.status(201).json(articles.create(article, String(req.user.id)));
});

app.put("/api/articles/:id", needTeam, express.json({ limit: "1mb" }), (req, res) => {
  const { article, errors } = cleanArticle(req.body);
  if (errors.length) return res.status(400).json({ error: errors.join(", ") });
  const saved = articles.update(req.params.id, article, String(req.user.id));
  saved ? res.json(saved) : res.status(404).json({ error: "ไม่พบเรื่องนี้ อาจถูกลบไปแล้ว" });
});

app.delete("/api/articles/:id", needTeam, (req, res) => {
  articles.remove(req.params.id, String(req.user.id))
    ? res.json({ ok: true })
    : res.status(404).json({ error: "ไม่พบเรื่องนี้" });
});

app.post("/api/articles/:id/feedback", express.json(), (req, res) => {
  const a = articles.get(req.params.id);
  if (!a || (!req.user && !a.userVisible)) return res.status(404).json({ error: "ไม่พบเรื่องนี้" });
  const v = Number(req.body?.value);
  if (![1, -1, 0].includes(v)) return res.status(400).json({ error: "ค่าไม่ถูกต้อง" });
  articles.vote(a.id, req.voter, v);
  res.json(articles.feedbackSummary(req.voter)[a.id] || { up: 0, down: 0, mine: 0 });
});

/* ---------- image uploads ---------- */
app.post(
  "/api/uploads",
  needTeam,
  express.raw({ type: Object.keys(IMG_TYPES), limit: "5mb" }),
  (req, res) => {
    const ext = IMG_TYPES[req.get("Content-Type")];
    if (!ext || !Buffer.isBuffer(req.body) || !req.body.length)
      return res.status(400).json({ error: "รองรับเฉพาะรูป PNG, JPG, WEBP, GIF ไม่เกิน 5MB" });
    const name = crypto.randomBytes(16).toString("hex") + "." + ext;
    fs.writeFileSync(path.join(UPLOAD_DIR, name), req.body);
    res.status(201).json({ url: "/uploads/" + name });
  }
);
app.use("/uploads", express.static(UPLOAD_DIR, { maxAge: "30d", index: false }));

/* ---------- users (admin) ---------- */
app.get("/api/users", needAdmin, (req, res) => res.json(users.list()));
app.post("/api/users", needAdmin, express.json(), (req, res) => {
  const { username, displayName, password, role } = req.body || {};
  if (!/^[a-zA-Z0-9._-]{3,30}$/.test(username || "")) return res.status(400).json({ error: "ชื่อผู้ใช้ใช้ a-z, 0-9, . _ - ยาว 3-30 ตัว" });
  if (String(password || "").length < 8) return res.status(400).json({ error: "รหัสผ่านต้องยาวอย่างน้อย 8 ตัว" });
  if (!["admin", "team"].includes(role)) return res.status(400).json({ error: "สิทธิ์ไม่ถูกต้อง" });
  if (users.byUsername(username)) return res.status(409).json({ error: "มีชื่อผู้ใช้นี้แล้ว" });
  const id = users.create(username, String(displayName || username).trim().slice(0, 100), password, role, 1);
  res.status(201).json(users.get(id));
});
app.put("/api/users/:id/password", needTeam, express.json(), (req, res) => {
  const id = Number(req.params.id);
  if (req.user.role !== "admin" && req.user.id !== id) return res.status(403).json({ error: "เปลี่ยนได้เฉพาะรหัสของตัวเอง" });
  if (String(req.body?.password || "").length < 8) return res.status(400).json({ error: "รหัสผ่านต้องยาวอย่างน้อย 8 ตัว" });
  if (!users.get(id)) return res.status(404).json({ error: "ไม่พบผู้ใช้" });
  const target = users.get(id);
  if (String(req.body.password).toLowerCase() === "admin" || String(req.body.password) === target?.username)
    return res.status(400).json({ error: "รหัสผ่านนี้เดาง่ายเกินไป ใช้รหัสอื่น" });
  // an admin resetting someone else's password: that person picks their own at next login
  users.setPassword(id, req.body.password, req.user.id !== id);
  if (req.user.id === id) {
    const s = sessions.create(id);
    setCookie(res, "kbs", s.token, s.maxAge);
  }
  res.json({ ok: true });
});
app.delete("/api/users/:id", needAdmin, (req, res) => {
  const u = users.get(Number(req.params.id));
  if (!u) return res.status(404).json({ error: "ไม่พบผู้ใช้" });
  if (u.id === req.user.id) return res.status(400).json({ error: "ลบบัญชีของตัวเองไม่ได้" });
  if (u.role === "admin" && users.adminCount() <= 1) return res.status(400).json({ error: "ต้องเหลือผู้ดูแลระบบอย่างน้อย 1 คน" });
  users.remove(u.id);
  res.json({ ok: true });
});

/* ---------- export / import ---------- */
app.get("/api/export", needTeam, (req, res) => {
  const day = new Date().toISOString().slice(0, 10);
  res.set("Content-Disposition", `attachment; filename="his-kb-${day}.json"`);
  res.json(articles.list(true));
});
app.post("/api/import", needAdmin, express.json({ limit: "20mb" }), (req, res) => {
  const items = Array.isArray(req.body) ? req.body : req.body?.articles;
  if (!Array.isArray(items)) return res.status(400).json({ error: "ไฟล์ต้องเป็นรายการ (JSON array) ของปัญหา" });
  let created = 0, updated = 0;
  const skipped = [];
  for (const raw of items) {
    // accepts both this app's export and the Claude-artifact database dump ({id, data:{...}})
    const item = raw && raw.data && typeof raw.data === "object" ? { ...raw.data, id: raw.id } : raw;
    const { article, errors } = cleanArticle(item || {});
    if (errors.length) { skipped.push(`${item?.title || item?.id || "?"}: ${errors.join(", ")}`); continue; }
    const id = typeof item.id === "string" && /^[\w.:@~+-]{1,100}$/.test(item.id) ? item.id : undefined;
    if (id && articles.get(id)) { articles.update(id, article, String(req.user.id)); updated++; }
    else { articles.create(article, String(req.user.id), { id, createdAt: item.createdAt }); created++; }
  }
  res.json({ created, updated, skipped });
});

/* ---------- past cases (from the case-tracking Excel export) ---------- */
const locations = require("./locations");
const area = (req) => ({ region: Number(req.query.region) || 0, prov: String(req.query.prov || "").slice(0, 50), unknown: req.query.area === "unknown" });
app.get("/api/cases/facets", needTeam, (req, res) => res.json(cases.facets()));
app.post(
  "/api/hospitals/import",
  needAdmin,
  express.raw({ type: () => true, limit: "30mb" }),
  async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: "ไม่พบไฟล์" });
    try {
      const r = await locations.importHospitals(req.body);
      cases.resetIndex();
      res.json(r);
    } catch (err) { res.status(400).json({ error: err.message }); }
  }
);
app.get("/api/cases/search", needTeam, (req, res) => {
  res.json(cases.search(String(req.query.q || "").slice(0, 300), Math.min(Number(req.query.limit) || 50, 200), area(req)));
});
app.get("/api/cases/frequent", needTeam, (req, res) =>
  res.json(cases.frequent(Math.min(Number(req.query.limit) || 40, 100), Number(req.query.days) || 0, area(req)))
);
app.get("/api/cases/stats", needTeam, (req, res) => res.json(cases.stats()));
app.post(
  "/api/cases/import",
  needAdmin,
  express.raw({ type: () => true, limit: "30mb" }),
  async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: "ไม่พบไฟล์" });
    try { res.json(await cases.importXlsx(req.body)); }
    catch (err) { res.status(400).json({ error: err.message }); }
  }
);

/* ---------- automatic pull from the case-tracking API ---------- */
const sync = require("./sync");
app.get("/api/sync", needTeam, (req, res) => {
  const st = sync.settings();
  // teammates only need to know whether the data is fresh
  res.json(req.user.role === "admin" ? st : { lastOk: st.lastOk, lastStatus: st.lastStatus, interval: st.interval, hasToken: st.hasToken });
});
app.put("/api/sync", needAdmin, express.json(), (req, res) => {
  try { res.json(sync.saveSettings(req.body || {})); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
app.delete("/api/sync/token", needAdmin, (req, res) => res.json(sync.clearToken()));
app.post("/api/sync/run", needAdmin, async (req, res) => {
  try { res.json({ result: await sync.syncNow(), settings: sync.settings() }); }
  catch (err) { res.status(err.expired ? 409 : 400).json({ error: err.message, settings: sync.settings() }); }
});
sync.startScheduler();

/* ---------- page ---------- */
app.use(express.static(path.join(__dirname, "public"), { index: "index.html" }));
app.use("/api", (req, res) => res.status(404).json({ error: "ไม่พบ API นี้" }));
app.use((err, req, res, next) => {
  if (err.type === "entity.too.large") return res.status(413).json({ error: "ไฟล์ใหญ่เกินไป" });
  console.error(err);
  res.status(500).json({ error: "เกิดข้อผิดพลาดที่ Server" });
});

const server = app.listen(PORT, HOST, () => {
  const lan = Object.values(require("os").networkInterfaces())
    .flat()
    .filter((n) => n && n.family === "IPv4" && !n.internal)
    .map((n) => `http://${n.address}:${PORT}`);
  console.log(`คลังวิธีแก้ปัญหา HIS พร้อมใช้งานแล้ว`);
  console.log(`  เครื่องนี้       : http://localhost:${PORT}`);
  if (HOST === "0.0.0.0") for (const u of lan) console.log(`  เครื่องอื่นในทีม : ${u}`);
  console.log(`ปิดหน้าต่างนี้เพื่อหยุดการทำงาน`);
});
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") console.error(`\nพอร์ต ${PORT} ถูกใช้อยู่ อาจเปิดโปรแกรมนี้ค้างไว้อีกหน้าต่างหนึ่ง ปิดหน้าต่างนั้นก่อน หรือเปลี่ยนพอร์ตด้วย set PORT=3001`);
  else console.error(err);
  process.exit(1);
});

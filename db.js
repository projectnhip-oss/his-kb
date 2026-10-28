const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
// SQLite ที่มากับ Node.js เอง (Node 22.13+) ไม่ต้อง compile และไม่ต้องติดตั้ง Visual Studio
const { DatabaseSync } = require("node:sqlite");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, "uploads"), { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, "kb.sqlite"));
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

/** Run fn inside BEGIN/COMMIT, rolling back on error. */
const transaction = (fn) => () => {
  db.exec("BEGIN");
  try { fn(); db.exec("COMMIT"); }
  catch (e) { db.exec("ROLLBACK"); throw e; }
};

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  pass_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','team')),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  aliases TEXT NOT NULL DEFAULT '[]',
  error_msg TEXT NOT NULL DEFAULT '',
  system TEXT NOT NULL DEFAULT 'อื่นๆ',
  level TEXT NOT NULL DEFAULT 'support',
  user_visible INTEGER NOT NULL DEFAULT 0,
  causes TEXT NOT NULL DEFAULT '[]',
  verify TEXT NOT NULL DEFAULT '',
  images TEXT NOT NULL DEFAULT '[]',
  example INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);
CREATE TABLE IF NOT EXISTS article_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id TEXT NOT NULL,
  action TEXT NOT NULL,
  data TEXT NOT NULL,
  at TEXT NOT NULL,
  by TEXT
);
CREATE TABLE IF NOT EXISTS feedback (
  article_id TEXT NOT NULL,
  voter TEXT NOT NULL,
  value INTEGER NOT NULL CHECK (value IN (1,-1)),
  at TEXT NOT NULL,
  PRIMARY KEY (article_id, voter)
);
`);

/* ---------- passwords ---------- */
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(pw, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}
function checkPassword(pw, stored) {
  const [salt, hash] = String(stored).split(":");
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(pw, salt, 64);
  return crypto.timingSafeEqual(test, Buffer.from(hash, "hex"));
}

/* ---------- articles ---------- */
const LEVELS = ["user", "support", "escalate"];

function rowToArticle(r) {
  return {
    id: r.id,
    title: r.title,
    aliases: JSON.parse(r.aliases),
    errorMsg: r.error_msg,
    system: r.system,
    level: r.level,
    userVisible: !!r.user_visible,
    causes: JSON.parse(r.causes),
    verify: r.verify,
    images: JSON.parse(r.images),
    example: !!r.example,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
  };
}

/** Validate and normalise an article body coming from the API or an import file. */
function cleanArticle(a) {
  const str = (v, max = 5000) => String(v ?? "").trim().slice(0, max);
  const list = (v) => (Array.isArray(v) ? v : []).map((x) => str(x, 1000)).filter(Boolean);
  const out = {
    title: str(a.title, 300),
    aliases: list(a.aliases),
    errorMsg: str(a.errorMsg, 3000),
    system: str(a.system, 100) || "อื่นๆ",
    level: LEVELS.includes(a.level) ? a.level : "support",
    userVisible: !!a.userVisible,
    causes: (Array.isArray(a.causes) ? a.causes : [])
      .map((c) => ({ cause: str(c?.cause, 500), steps: list(c?.steps) }))
      .filter((c) => c.cause || c.steps.length),
    verify: str(a.verify, 2000),
    images: (Array.isArray(a.images) ? a.images : [])
      .map((i) => ({ url: str(i?.url, 300), caption: str(i?.caption, 300) }))
      .filter((i) => /^\/uploads\/[a-f0-9]{32}\.(png|jpe?g|webp|gif)$/.test(i.url)),
    example: !!a.example,
  };
  const errors = [];
  if (!out.title) errors.push("ต้องมีชื่อปัญหา");
  if (!out.causes.length) errors.push("ต้องมีสาเหตุอย่างน้อย 1 ข้อ");
  if (out.causes.some((c) => !c.cause || !c.steps.length)) errors.push("แต่ละสาเหตุต้องมีชื่อและขั้นตอนอย่างน้อย 1 ขั้น");
  return { article: out, errors };
}

const stmt = {
  all: db.prepare("SELECT * FROM articles"),
  allVisible: db.prepare("SELECT * FROM articles WHERE user_visible = 1"),
  get: db.prepare("SELECT * FROM articles WHERE id = ?"),
  insert: db.prepare(`INSERT INTO articles
    (id,title,aliases,error_msg,system,level,user_visible,causes,verify,images,example,created_at,updated_at,updated_by)
    VALUES (@id,@title,@aliases,@errorMsg,@system,@level,@userVisible,@causes,@verify,@images,@example,@createdAt,@updatedAt,@updatedBy)`),
  update: db.prepare(`UPDATE articles SET title=@title,aliases=@aliases,error_msg=@errorMsg,system=@system,level=@level,
    user_visible=@userVisible,causes=@causes,verify=@verify,images=@images,example=@example,updated_at=@updatedAt,updated_by=@updatedBy
    WHERE id=@id`),
  del: db.prepare("DELETE FROM articles WHERE id = ?"),
  history: db.prepare("INSERT INTO article_history (article_id,action,data,at,by) VALUES (?,?,?,?,?)"),
  fbAll: db.prepare("SELECT article_id, value, voter FROM feedback"),
  fbSet: db.prepare(`INSERT INTO feedback (article_id,voter,value,at) VALUES (?,?,?,?)
    ON CONFLICT(article_id,voter) DO UPDATE SET value=excluded.value, at=excluded.at`),
  fbDel: db.prepare("DELETE FROM feedback WHERE article_id = ? AND voter = ?"),
  fbDelArticle: db.prepare("DELETE FROM feedback WHERE article_id = ?"),
};

function toParams(id, a, extra) {
  return {
    id,
    title: a.title,
    aliases: JSON.stringify(a.aliases),
    errorMsg: a.errorMsg,
    system: a.system,
    level: a.level,
    userVisible: a.userVisible ? 1 : 0,
    causes: JSON.stringify(a.causes),
    verify: a.verify,
    images: JSON.stringify(a.images),
    example: a.example ? 1 : 0,
    ...extra,
  };
}

const articles = {
  list(includeHidden) {
    return (includeHidden ? stmt.all : stmt.allVisible).all().map(rowToArticle);
  },
  get(id) {
    const r = stmt.get.get(id);
    return r ? rowToArticle(r) : null;
  },
  create(a, by, opts = {}) {
    const now = new Date().toISOString();
    const id = opts.id || crypto.randomUUID();
    stmt.insert.run(toParams(id, a, { createdAt: opts.createdAt || now, updatedAt: opts.updatedAt || now, updatedBy: by }));
    return this.get(id);
  },
  update(id, a, by) {
    const prev = stmt.get.get(id);
    if (!prev) return null;
    const now = new Date().toISOString();
    transaction(() => {
      stmt.history.run(id, "update", JSON.stringify(rowToArticle(prev)), now, by);
      stmt.update.run(toParams(id, a, { updatedAt: now, updatedBy: by }));
    })();
    return this.get(id);
  },
  remove(id, by) {
    const prev = stmt.get.get(id);
    if (!prev) return false;
    transaction(() => {
      stmt.history.run(id, "delete", JSON.stringify(rowToArticle(prev)), new Date().toISOString(), by);
      stmt.del.run(id);
      stmt.fbDelArticle.run(id);
    })();
    return true;
  },
  feedbackSummary(voter) {
    const out = {};
    for (const f of stmt.fbAll.all()) {
      const s = (out[f.article_id] ||= { up: 0, down: 0, mine: 0 });
      f.value === 1 ? s.up++ : s.down++;
      if (f.voter === voter) s.mine = f.value;
    }
    return out;
  },
  vote(articleId, voter, value) {
    if (value === 0) stmt.fbDel.run(articleId, voter);
    else stmt.fbSet.run(articleId, voter, value, new Date().toISOString());
  },
};

/* ---------- users & sessions ---------- */
const SESSION_DAYS = 14;
const users = {
  count: () => db.prepare("SELECT COUNT(*) n FROM users").get().n,
  list: () => db.prepare("SELECT id, username, display_name AS displayName, role, created_at AS createdAt FROM users ORDER BY id").all(),
  byUsername: (u) => db.prepare("SELECT * FROM users WHERE username = ?").get(u),
  create(username, displayName, password, role) {
    const info = db
      .prepare("INSERT INTO users (username, display_name, pass_hash, role, created_at) VALUES (?,?,?,?,?)")
      .run(username, displayName, hashPassword(password), role, new Date().toISOString());
    return Number(info.lastInsertRowid);
  },
  setPassword(id, password) {
    db.prepare("UPDATE users SET pass_hash = ? WHERE id = ?").run(hashPassword(password), id);
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
  },
  remove: (id) => db.prepare("DELETE FROM users WHERE id = ?").run(id).changes > 0,
  adminCount: () => db.prepare("SELECT COUNT(*) n FROM users WHERE role='admin'").get().n,
  get: (id) => db.prepare("SELECT id, username, display_name AS displayName, role FROM users WHERE id = ?").get(id),
};
const sessions = {
  create(userId) {
    const token = crypto.randomBytes(32).toString("hex");
    const exp = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
    db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)").run(token, userId, exp);
    return { token, maxAge: SESSION_DAYS * 864e5 };
  },
  user(token) {
    if (!token) return null;
    return (
      db
        .prepare(`SELECT u.id, u.username, u.display_name AS displayName, u.role FROM sessions s
                  JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?`)
        .get(token, new Date().toISOString()) || null
    );
  },
  destroy: (token) => db.prepare("DELETE FROM sessions WHERE token = ?").run(token),
  purge: () => db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(new Date().toISOString()),
};

module.exports = { db, DATA_DIR, articles, users, sessions, cleanArticle, checkPassword };

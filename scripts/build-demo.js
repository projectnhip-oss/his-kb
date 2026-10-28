// สร้างเวอร์ชันทดลองแบบไม่มี Server สำหรับ GitHub Pages
// ใช้งาน: node scripts/build-demo.js [โฟลเดอร์ปลายทาง]   (ค่าเริ่มต้น demo-site)
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const out = path.resolve(process.argv[2] || path.join(root, "demo-site"));
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

for (const f of fs.readdirSync(path.join(root, "public"))) fs.copyFileSync(path.join(root, "public", f), path.join(out, f));
for (const f of ["demo.js", "demo-data.js"]) fs.copyFileSync(path.join(root, "demo", f), path.join(out, f));

// example articles: the same ones a new server starts with, plus a few votes so sorting shows
const seed = JSON.parse(fs.readFileSync(path.join(root, "seed-data.json"), "utf8"))
  .map((a, i) => ({ ...a, example: true, demoVotes: { up: [6, 9, 3, 4][i % 4], down: [1, 0, 1, 2][i % 4] } }));
fs.writeFileSync(path.join(out, "demo-articles.js"), "window.KB_DEMO_ARTICLES = " + JSON.stringify(seed) + ";\n");

let html = fs.readFileSync(path.join(out, "index.html"), "utf8");
html = html.replace('<script src="app.js"></script>',
  '<script src="search-core.js"></script>\n<script src="demo-articles.js"></script>\n<script src="demo-data.js"></script>\n<script src="demo.js"></script>\n<script src="app.js"></script>');
html = html.replace("<title>คลังวิธีแก้ปัญหา HIS</title>", "<title>คลังวิธีแก้ปัญหา HIS (ทดลอง)</title>");
fs.writeFileSync(path.join(out, "index.html"), html);
fs.appendFileSync(path.join(out, "style.css"), `
/* preview banner (demo only) */
.demo-banner{background:var(--warn-soft);color:var(--warn);font-size:.85rem;padding:6px 16px;display:flex;gap:6px 10px;flex-wrap:wrap;align-items:center;justify-content:center;text-align:center}
.demo-banner button{border:1px solid currentColor;background:none;color:inherit;border-radius:6px;padding:1px 8px;cursor:pointer;font:inherit}
`);
fs.writeFileSync(path.join(out, ".nojekyll"), ""); // GitHub Pages: serve files as they are
console.log("สร้างเวอร์ชันทดลองที่ " + out);

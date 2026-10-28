// ใช้งาน: npm run create-user -- <ชื่อผู้ใช้> <รหัสผ่าน> [admin|team] [ชื่อที่แสดง]
// ถ้ามีผู้ใช้ชื่อนี้อยู่แล้ว จะเปลี่ยนรหัสผ่านให้แทน (ใช้กู้บัญชีเมื่อลืมรหัส)
const { users } = require("../db");

const [username, password, role = "team", ...name] = process.argv.slice(2);
if (!username || !password) {
  console.log("ใช้งาน: npm run create-user -- <ชื่อผู้ใช้> <รหัสผ่าน> [admin|team] [ชื่อที่แสดง]");
  process.exit(1);
}
if (password.length < 5) {
  console.log("รหัสผ่านต้องยาวอย่างน้อย 5 ตัว");
  process.exit(1);
}
const existing = users.byUsername(username);
if (existing) {
  users.setPassword(existing.id, password);
  console.log(`เปลี่ยนรหัสผ่านของ ${username} แล้ว`);
} else {
  if (!["admin", "team"].includes(role)) {
    console.log("สิทธิ์ต้องเป็น admin หรือ team");
    process.exit(1);
  }
  users.create(username, name.join(" ") || username, password, role);
  console.log(`สร้างผู้ใช้ ${username} (${role}) แล้ว`);
}

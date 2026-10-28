// ทำให้คำที่สะกดต่างกันแต่ความหมายเดียวกันค้นเจอกัน ใช้ทั้งฝั่งหน้าเว็บและ Server
// เช่น ปริ้น/ปริ๊น/พิมพ์, สติ๊กเกอร์/สติกเกอร์, สิทธิ/สิทธิ์, ไม่ได้/ไม่สามารถ
(function (root) {
  // Applied after tone marks are removed, so patterns are written without them.
  const SYNONYMS = [
    [/ปริ?[นณ]ท?|พิมพ|printer|print/g, "ปริน"],
    [/สติ[กค]เกอ?ร?|sticker/g, "สติกเกอร"],
    [/ล[อ]?[กค]อิน|log ?-?in|เขาระบบ|เขาสูระบบ|เขาโปรแกรม|เขาใชงาน/g, "เขาระบบ"],
    [/สิทธิ?/g, "สิทธิ"],
    [/claim/g, "เคลม"],
    [/cache|แค[ชร]/g, "แคช"],
    [/อิน[เท]?[ตท]อ?ร?เน[ตท]|internet|wifi|ไวไฟ/g, "เนต"],
    [/token|โทเคน/g, "token"],
    [/agent|เอเจน[ตท]?/g, "agent"],
    [/scan/g, "สแกน"],
    [/แลป|lab/g, "แลบ"],
    [/ไมได|ไมสามารถ|ไมขึน|ไมออก|ไมมา|ไมทำงาน|เสีย/g, "ไมได"],
  ];
  const PARTICLES = /(คะ|ครับ|คับ|นะ|จา|จะ|ฮะ|คา)(?=\s|$)/g;

  function kbNorm(s) {
    let t = String(s == null ? "" : s).toLowerCase().replace(/เเ/g, "แ").replace(/[็-์]/g, ""); // ็ ่ ้ ๊ ๋ ์
    for (const [re, to] of SYNONYMS) t = t.replace(re, to);
    return t.replace(/[^ก-๛a-z0-9]+/g, " ").replace(PARTICLES, "").replace(/\s+/g, " ").trim();
  }

  if (typeof module !== "undefined" && module.exports) module.exports = kbNorm;
  else root.kbNorm = kbNorm;
})(this);

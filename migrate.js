'use strict';
// نبراس — ترحيل بيانات localStorage القديمة (server/data/BOYS.json + GIRLS.json) إلى PostgreSQL
// الاستخدام: node migrate.js  (ينشئ الجداول ثم يستورد؛ آمن لإعادة التشغيل)
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('./db');

const DATA_DIR = path.join(__dirname, 'data');
const BCRYPT_ROUNDS = 10;

// إزالة تكرار البريد عبر القسمين معًا (نحوّل إليه كل القسم قبل الاستيراد): admin@nibras.local -> admin-girls@nibras.local
const seenEmails = new Map();
function dedupeEmails(users) {
  const seen = seenEmails;
  users.forEach(u => {
    const base = String(u.email || '').toLowerCase().trim();
    let email = base;
    let n = 2;
    while (seen.has(email)) {
      const at = base.lastIndexOf('@');
      email = (at > 0 ? base.slice(0, at) + '-' + n : base + '-' + n) + (at > 0 ? base.slice(at) : '@nibras.local');
      n++;
    }
    seen.set(email, true);
    u.email = email;
  });
}

function toData(u) {
  const out = {};
  ['absences','markedLate','lateMinutes','lateType','loginHistory','lastLogin','loginCount','whatsapp','lastSeenAt']
    .forEach(k => { if (u[k] !== undefined) out[k] = u[k]; });
  return out;
}

async function migrate() {
  await db.initSchema();
  await db.sweepSessions();

  for (const school of db.SCHOOLS) {
    const file = path.join(DATA_DIR, school + '.json');
    let rec;
    try { rec = JSON.parse(require('fs').readFileSync(file, 'utf8')); }
    catch (e) { console.error('⚠️ لا يمكن قراءة ' + file + ' — ' + e.message); continue; }
    const data = rec && rec.data || {};
    const users = Array.isArray(data.users) ? data.users : [];
    dedupeEmails(users);

    for (const u of users) {
      const pw = String(u.password || '');
      const hash = pw ? await bcrypt.hash(pw, BCRYPT_ROUNDS) : await bcrypt.hash('Nibras@2026', BCRYPT_ROUNDS);
      await db.insertUser({
        id: u.id, school,
        name: String(u.name || '').trim() || u.id,
        email: u.email,
        password_hash: hash,
        role: u.role || 'TEACHER',
        active: u.active !== false,
        first_login: true, // كل الحسابات تُجبر على تغيير كلمة المرور بعد الترحيل
        data: toData(u),
      });
    }
    // نسخة نظيفة للتخزين: بلا كلمات مرور / أرقام سرية / رموز استرجاع
    const clean = JSON.parse(JSON.stringify(data));
    if (Array.isArray(clean.users)) {
      clean.users.forEach(u => {
        ['password','secret','initialSecret','resetCode','resetExpires'].forEach(k => delete u[k]);
      });
    }
    await db.setSchoolData(school, clean, Date.now());
    console.log(`✅ ${school}: ${users.length} مستخدمًا، استُوردت البيانات (${data.students ? data.students.length : 0} طالبًا)`);
  }

  console.log('اكتمل الترحيل. جميع الحسابات now at first_login — يجب تغيير كلمة المرور عند أول دخول.');
}

migrate().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });

'use strict';
// نبراس — إعادة تعيين كلمة مرور حساب المدير إلى Nibras@2026
// التشغيل من داخل مجلد المشروع في Shell الخاص بـ Render:
//   node reset_admin.js
const bcrypt = require('bcryptjs');
const db = require('./db');

const NEW_PW = 'Nibras@2026';

(async () => {
  let u = await db.userByUsername('admin');
  if (!u) u = await db.userByEmail('admin@nibras.local');
  if (!u) {
    const all = await db.pool.query(`SELECT id, name, email, username FROM users WHERE role = 'ADMIN' ORDER BY id`);
    if (!all.rows.length) return console.error('❌ لا يوجد أي حساب ADMIN في قاعدة البيانات — نفّذ: node seed  ثم استخدم الكلمة المطبوعة');
    if (all.rows.length > 1) {
      console.error('⚠️ يوجد أكثر من مدير — حدّد الهدف:');
      for (const r of all.rows) console.error('   ' + r.id + '  ' + r.name + '  ' + (r.username || r.email));
      return process.exit(1);
    }
    u = all.rows[0];
  }
  const hash = await bcrypt.hash(NEW_PW, 10);
  await db.updateUserPasswordHash(u.id, hash, false);
  await db.deleteUserSessions(u.id);
  console.log('✅ تم إعادة تعيين كلمة مرور:');
  console.log('   المستخدم: ' + (u.username || 'admin'));
  console.log('   البريد:   ' + (u.email || 'admin@nibras.local'));
  console.log('   كلمة المرور: ' + NEW_PW);
})().catch(e => { console.error('❌ خطأ:', (e && e.message) || e); process.exit(1); });
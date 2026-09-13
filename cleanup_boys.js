'use strict';
// نبراس — تنظيف قسم البنين نهائياً بعد إلغائه (يعمل مرة واحدة، وآمن لإعادة التشغيل)
// يحذف كل أثر BOYS من قاعدة PostgreSQL، ويطهر نسخة GIRLS من حسابات البنين الملوِّثة
// الاستخدام:
//   داخل بيئة Render (حيث DATABASE_URL مضبوط تلقائياً):  node cleanup_boys.js
//   محلياً:                                              DATABASE_URL="postgres://…" node cleanup_boys.js
const db = require('./db');

async function main() {
  console.log('🔍 بدء تنظيف قسم البنين…');

  // 1) حسابات البنين في جدول users (الجلسات المرتبطة تُحذف تلقائياً عبر ON DELETE CASCADE)
  const boysUsers = await db.pool.query(`SELECT id, name, role FROM users WHERE school = 'BOYS' ORDER BY name`);
  console.log(`👤 حسابات بنين في users: ${boysUsers.rows.length}`);
  for (const u of boysUsers.rows) console.log(`   - ${u.name} (${u.role}) [${u.id}]`);

  // 2) جلسات بنين منفصلة (إن وُجدت بلا مستخدم)
  const delSessions = await db.pool.query(`DELETE FROM sessions WHERE school = 'BOYS'`);
  console.log(`🔐 جلسات بنين محذوفة: ${delSessions.rowCount}`);

  if (boysUsers.rows.length) {
    const ids = boysUsers.rows.map(r => r.id);
    // 3) طهر نسخة GIRLS من الحسابات الملوِّثة بهذه المعرّفات + أي مستخدم سُجّل بقسم بنين داخل بيانات البنات
    const gd = await db.getSchoolData('GIRLS');
    if (gd.data && Array.isArray(gd.data.users)) {
      const before = gd.data.users.length;
      const polluted = new Set(ids);
      const keep = [];
      let removed = 0;
      for (const u of gd.data.users) {
        if (u && (polluted.has(u.id) || u.school === 'BOYS')) { removed++; continue; }
        keep.push(u);
      }
      if (removed) {
        gd.data.users = keep;
        await db.setSchoolData('GIRLS', gd.data, gd.ts);
        console.log(`🧹 نسخة GIRLS: أُزيل ${removed} حساب بنين (كانت ${before} ← أصبحت ${keep.length})`);
      } else {
        console.log(`🧹 نسخة GIRLS: لا حسابات بنين ملوِّثة`);
      }
    }
    // 4) حذف حسابات البنين من جدول users
    const delUsers = await db.pool.query(`DELETE FROM users WHERE school = 'BOYS'`);
    console.log(`👤 مستخدمو بنين محذوفون: ${delUsers.rowCount}`);
  } else {
    console.log(`🧹 نسخة GIRLS: لا شيء — لا حسابات بنين في users`);
  }

  // 5) بقية صفوف BOYS في الجداول
  const t1 = await db.pool.query(`DELETE FROM school_data  WHERE school = 'BOYS'`);
  const t2 = await db.pool.query(`DELETE FROM data_backups WHERE school = 'BOYS'`);
  const t3 = await db.pool.query(`DELETE FROM app_settings WHERE school = 'BOYS'`);
  const t4 = await db.pool.query(`DELETE FROM sync_audit   WHERE school = 'BOYS'`);
  console.log(`🗂 school_data: ${t1.rowCount} · data_backups: ${t2.rowCount} · app_settings: ${t3.rowCount} · sync_audit: ${t4.rowCount} صف BOYS محذوف`);

  // 6) التحقق النهائي
  const check = await db.pool.query(`SELECT school, count(*) AS n FROM users GROUP BY school ORDER BY school`);
  console.log('✅ التحقق — حسابات users حسب القسم:', check.rows);
  const boysLeft = await db.pool.query(`SELECT count(*)::int AS n FROM users WHERE school = 'BOYS'`);
  if (boysLeft.rows[0].n > 0) console.error('⚠️ ما زال هناك حسابات بنين!');
  else console.log('🧼 قسم البنين نظيف تماماً.');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
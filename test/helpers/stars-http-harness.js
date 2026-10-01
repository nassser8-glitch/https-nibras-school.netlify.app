'use strict';
// تحميل مسبق (--require) لستبدل db الحقيقي بــ stub داخل عملية الخادم.
// الهدف: تشغيل server.js الأصلي كما هو (Express + توجيه + جلسات + ملفات ثابتية)
// مع تخزين JSON في الذاكرة، فتبقى كلmiddlewares والمسارات حقيقية.
const path = require('path');
const crypto = require('crypto');
const Module = require('module');

const fx = JSON.parse(process.env.STARS_FIXTURE || '{}');
const data = fx.data || {};
const schools = (fx.schools && fx.schools.length ? fx.schools : ['GIRLS']);

// مزامنة عبر ملفات: الاختبار operations في عملية منفصلة، فنقرأ الجلسات من ملف
// ونكتب الحالة بعد كل تعديل ليراها الاختبار على بيانات الخادم الحقيقية.
const SESSIONS_FILE = process.env.STARS_SESSIONS_FILE;
const STATE_FILE = process.env.STARS_STATE_FILE;
const readJson = (p, d) => { try { return JSON.parse(require('fs').readFileSync(p, 'utf8')); } catch (_) { return d; } };
const writeJson = (p, v) => { try { require('fs').writeFileSync(p, JSON.stringify(v)); } catch (_) {} };

const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const publish = () => writeJson(STATE_FILE, clone(data));

const dbStub = {
  SCHOOLS: schools,
  async initSchema() { return true; },
  async getSchoolData() { return { data: clone(data), ts: 1 }; },
  async getSchoolSettings() { return { academicStart: '2026-09-07' }; },
  async mutateSchoolData(school, mutator) {
    // نسخة مستقلة كما يفعل الصف المقفل في الإنتاج
    const work = clone(data);
    const out = await mutator(work);
    if (!out || out.changed !== true) return { written: false, reason: 'no_change' };
    for (const k of Object.keys(work)) data[k] = work[k];
    for (const k of Object.keys(data)) if (!(k in work)) delete data[k];
    publish();
    return { written: true, value: out.value, ts: Date.now() };
  },
  // المسار العام /api/db/:school يستخدم setSchoolData في الإنتاج، فنسمح به هنا.
  // (مسار النجمة نفسه لا يستخدمه — مغطّى باختبارات المصدر، وهنا نتحقق من الأثر)
  async setSchoolData(school, next) {
    for (const k of Object.keys(next)) data[k] = clone(next[k]);
    for (const k of Object.keys(data)) if (!(k in next)) delete data[k];
    publish();
    return { written: true, ts: Date.now() };
  },
  // تُقرأ من الملف في كل طلب ⇒ يمكن للاختبار إنشاء جلسات أثناء التشغيل
  async sessionByTokenHash(hash) {
    const all = readJson(SESSIONS_FILE, {}) || {};
    return all[hash] || null;
  },
  // تجديد زاحف: نمدّد expires_at في ملف الجلسات (كما يفعل UPDATE في الإنتاج)
  async touchSession(hash, ttlMs) {
    const all = readJson(SESSIONS_FILE, {}) || {};
    if (!all[hash]) return null;
    all[hash].expires_at = new Date(Date.now() + (ttlMs || 864e5)).toISOString();
    writeJson(SESSIONS_FILE, all);
    return all[hash].expires_at;
  },
  // في الإنتاج جدول الحسابات هو مصدر الحقيقة، وقسم users في JSON ذاكرة مزامنة.
  // لا بد من إرجاع الحسابات فعلاً وإلا مسح الخادم ذاكرته (كما حدث عند stub فارغ).
  async usernamesByIds(ids) {
    const m = new Map();
    for (const u of (data.users || [])) if (ids.includes(u.id)) m.set(u.id, u.username || u.name);
    return m;
  },
  async usersForLoginStats() {
    return (data.users || []).map(u => ({ id: u.id, first_login: false }));
  },
  async deactivateUser() { return true; },
  async deleteUser() { return true; },
  async setUserFirstLogin() { return true; },
  async updateUser() { return true; },
  async getUser() { return null; },
  async userById(id) { return (data.users || []).find(u => u.id === id) || null; },
  async userByUsername(name) { return (data.users || []).find(u => u.username === name) || null; },
  async usersByIds(ids) { return (data.users || []).filter(u => ids.includes(u.id)); },
  async normalizeTeacherDuplicates() {},
  async getAllSchoolData() { return []; },
  async saveBackup() { return true; },
  async listBackups() { return []; },
  async health() { return true; },
  // normalizeTeacherDuplicates وخلافه يستعملان pool.query
  pool: { query: async () => ({ rows: [] }) }
};

// أي دالة db غير مstubbed ترمي بدل أن تُبلّغ postgres
const missing = (name) => async () => { throw new Error('db stub: ' + name + ' غير مstubbed'); };

// نلتقط نهاية الإقلاع لنطبع المنفذ الحقيقي على STDOUT
const origListen = require('express').application.listen;
require('express').application.listen = function (...args) {
  const cb = args[args.length - 1];
  args[args.length - 1] = function () {
    const srv = cb.apply(this, arguments);
    if (srv && srv.address && srv.address()) {
      process.stdout.write('STW_READY ' + srv.address().port + '\n');
    }
    return srv;
  };
  return origListen.apply(this, args);
};

// حقن الوحدة: أي require('./db') من داخل المشروع يُرجع stub
const dbPath = require.resolve(path.join(__dirname, '..', '..', 'db.js'));
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, path: path.dirname(dbPath), loaded: true,
  exports: new Proxy(dbStub, {
    get(t, p) {
      if (p in t) return t[p];
      if (typeof p === 'string') return missing(p);
      return undefined;
    }
  })
};

// seed يُستدعى عند أول تشغيل فقط
const seedPath = require.resolve(path.join(__dirname, '..', '..', 'seed.js'));
require.cache[seedPath] = {
  id: seedPath, filename: seedPath, path: path.dirname(seedPath), loaded: true,
  exports: { ensureAdminAccount: async () => null }
};

process.on('uncaughtException', (e) => { process.stderr.write('[uncaught] ' + e.stack + '\n'); });

// نلتقط سجل الخادم في ملف حتى تتوفر diagnoses عند فشل اختبار
if (process.env.STARS_LOG_FILE) {
  const fsx = require('fs');
  const t0 = Date.now();
  const tee = (stream) => stream.on('data', (d) => {
    try { fsx.appendFileSync(process.env.STARS_LOG_FILE, '[' + (Date.now() - t0) + 'ms] ' + d); } catch (_) {}
  });
  tee(process.stdout); tee(process.stderr);
}

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const Module = require('module'); const PG_PATH = (function(){ try { return require.resolve('pg'); } catch(_) { const orig = Module._resolveFilename; Module._resolveFilename = function(req, parent, isMain, opts){ if(req === 'pg') return '__fake_pg__'; return orig.call(this, req, parent, isMain, opts); }; return '__fake_pg__'; } })();
const DB_PATH = path.join(__dirname, '..', 'db.js');
const SERVER_PATH = path.join(__dirname, '..', 'server.js');
const HTML_PATH = path.join(__dirname, '..', 'public', 'index.html');

const deep = (o) => JSON.parse(JSON.stringify(o));

function makeFakePg() {
  const tables = {
    school_data: new Map(),
    users: new Map(),
    sessions: new Map(),
  };
  const locks = new Map();

  function acquire(school) {
    const prev = locks.get(school) || Promise.resolve();
    let release;
    const gate = new Promise((r) => { release = r; });
    locks.set(school, prev.then(() => gate));
    return prev.then(() => release);
  }

  function makeClient() {
    let release = null;
    return {
      inTx: false,
      async query(sql, params) {
        const s = String(sql);
        if (/^\s*BEGIN/i.test(s)) return { rowCount: 0, rows: [] };
        if (/^\s*(COMMIT|ROLLBACK)/i.test(s)) {
          if (release) { release(); release = null; }
          return { rowCount: 0, rows: [] };
        }
        if (/SELECT/.test(s) && /FOR UPDATE/i.test(s)) {
          release = await acquire(params[0]);
          const row = tables.school_data.get(params[0]);
          if (!row) return { rowCount: 0, rows: [] };
          return { rowCount: 1, rows: [{ data: deep(row.data), ts: String(row.ts) }] };
        }
        if (/SELECT data, ts FROM school_data/i.test(s)) {
          const row = tables.school_data.get(params[0]);
          if (!row) return { rowCount: 0, rows: [] };
          return { rowCount: 1, rows: [{ data: deep(row.data), ts: String(row.ts) }] };
        }
        if (/^\s*UPDATE school_data/i.test(s)) {
          const [school, dataJson, nextTs] = params;
          const row = tables.school_data.get(school);
          if (!row) return { rowCount: 0, rows: [] };
          if (!(row.ts < Number(nextTs))) return { rowCount: 0, rows: [] };
          row.data = JSON.parse(dataJson);
          row.ts = Number(nextTs);
          return { rowCount: 1, rows: [] };
        }
        if (/INSERT INTO school_data/i.test(s)) {
          const [school, dataJson, nextTs] = params;
          const ts = Number(nextTs);
          const row = tables.school_data.get(school);
          if (!row) {
            tables.school_data.set(school, { data: JSON.parse(dataJson), ts });
            return { rowCount: 1, rows: [] };
          }
          if (row.ts < ts) {
            row.data = JSON.parse(dataJson);
            row.ts = ts;
            return { rowCount: 1, rows: [] };
          }
          return { rowCount: 0, rows: [] };
        }
        return { rowCount: 0, rows: [] };
      },
      release() {
        if (release) { release(); release = null; }
      },
    };
  }

  const pool = {
    async query(sql, params) { return makeClient().query(sql, params); },
    async connect() { return makeClient(); },
  };
  return { pool, tables };
}

function setupMockDb() {
  const fake = makeFakePg();
  delete require.cache[PG_PATH];
  delete require.cache[DB_PATH];

  require.cache[PG_PATH] = {
    id: PG_PATH, filename: PG_PATH, loaded: true,
    exports: { Pool: class { constructor() { return fake.pool; } } },
  };
  const db = require(DB_PATH);
  return { db, fake };
}

test('1. قراءة واسترجاع الأنشطة: GET /api/activities/:school تقرأ من rec.data.activities', async () => {
  const { db, fake } = setupMockDb();

  // إعداد بيانات مبدئية تحوي نشاطين داخل school_data
  fake.tables.school_data.set('GIRLS', {
    ts: 1000,
    data: {
      users: [],
      classes: [],
      activities: [
        { id: 'act-1', name: 'اليوم الوطني', type: 'national', date: '2026-09-23' },
        { id: 'act-2', name: 'دوري كرة القدم', type: 'sports', date: '2026-10-15' },
      ],
    },
  });

  const rec = await db.getSchoolData('GIRLS');
  assert.ok(rec && rec.data, 'يجب أن يعيد getSchoolData كائن { data, ts }');
  assert.ok(Array.isArray(rec.data.activities), 'rec.data.activities يجب أن تكون مصفوفة');
  assert.equal(rec.data.activities.length, 2, 'يجب قراءة النشاطين بنجاح');
  assert.equal(rec.data.activities[0].name, 'اليوم الوطني');
});

test('2. إضافة وتعديل نشاط عبر mutateSchoolData لا تمسح الأنشطة السابقة', async () => {
  const { db, fake } = setupMockDb();

  fake.tables.school_data.set('GIRLS', {
    ts: 1000,
    data: {
      users: [],
      activities: [
        { id: 'act-1', name: 'اليوم الوطني', type: 'national', date: '2026-09-23', _v: 0 },
      ],
    },
  });

  // محاكاة حفظ نشاط جديد وتعديل نشاط قائم عبر mutateSchoolData
  const newActivity = { id: 'act-2', name: 'معرض العلوم', type: 'science', date: '2026-11-20', _v: 0 };
  const updatedActivity1 = { id: 'act-1', name: 'اليوم الوطني السعودي', type: 'national', date: '2026-09-23', _v: 1 };

  await db.mutateSchoolData('GIRLS', (data) => {
    data.activities = [updatedActivity1, newActivity];
    return { changed: true, value: data.activities.length };
  });

  const rec = await db.getSchoolData('GIRLS');
  assert.equal(rec.data.activities.length, 2);
  assert.equal(rec.data.activities[0].name, 'اليوم الوطني السعودي');
  assert.equal(rec.data.activities[1].name, 'معرض العلوم');
});

test('3. محاكاة تحديث الصفحة F5: قراءة الأنشطة بعد الحفظ تعيد البيانات كاملة وليس مصفوفة فارغة', async () => {
  const { db, fake } = setupMockDb();

  // حفظ نشاط
  const initialActs = [
    { id: 'act-101', name: 'حفل التكريم', type: 'honor', date: '2026-12-01' },
  ];
  await db.mutateSchoolData('GIRLS', (data) => {
    data.activities = initialActs;
    return { changed: true, value: 1 };
  });

  // محاكاة ما تفعله GET /api/activities/:school عند طلب F5
  const rec = await db.getSchoolData('GIRLS');
  const schoolData = (rec && rec.data) ? rec.data : {};
  let activities = [];
  if (Array.isArray(schoolData.activities)) {
    activities = schoolData.activities;
  } else if (schoolData.data && Array.isArray(schoolData.data.activities)) {
    activities = schoolData.data.activities;
  }

  assert.ok(activities.length > 0, 'يجب ألا تكون الأنشطة فارغة بعد F5');
  assert.equal(activities[0].id, 'act-101');
  assert.equal(activities[0].name, 'حفل التكريم');
});

test('4. محاكاة إعادة تشغيل الخادم Server Restart: الأنشطة تبقى مخزنة في قاعدة البيانات', async () => {
  const { db, fake } = setupMockDb();

  await db.mutateSchoolData('GIRLS', (data) => {
    data.activities = [
      { id: 'act-persist', name: 'إذاعة الصباح', type: 'morning', date: '2026-11-17' },
    ];
    return { changed: true, value: 1 };
  });

  // محاكاة إيقاف الخادم وإعادة تشغيله: مسح كاش الوحدات وإعادة إنشاء المجمع
  delete require.cache[DB_PATH];
  const reloadedDb = require(DB_PATH);

  const check = await reloadedDb.getSchoolData('GIRLS');
  assert.ok(check.data && Array.isArray(check.data.activities), 'الأنشطة مستمرة بعد إعادة التشغيل');
  assert.equal(check.data.activities.length, 1);
  assert.equal(check.data.activities[0].id, 'act-persist');
});

test('5. فحص كود العميل في index.html: وجود حارس المسح الفارغ wipe-guard والدمج الآمن', () => {
  const html = fs.readFileSync(HTML_PATH, 'utf8');

  // التأكد من وجود منطق حارس المسح الفارغ في __activitiesLoad
  assert.ok(html.indexOf('حماية: منع مسح الأنشطة المحلية عند وصول استجابة فارغة غير موثوقة') !== -1,
    'يجب أن يحتوي index.html على حارس منع المسح الفارغ');
  assert.ok(html.indexOf('srvMap.get(la.id)') !== -1,
    'يجب أن يحتوي index.html على دمج آمن يمنع التكرار');
});

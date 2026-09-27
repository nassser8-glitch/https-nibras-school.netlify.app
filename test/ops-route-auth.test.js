'use strict';
// regression: مسارات /api/ops لا يجوز أن تكون مفتوحة لغير المصادَق.
//
// /api/ops/ensure-girls-admin كان ينشئ حساب ADMIN بكلمة مرور مُضمَّنة بلا أي تحقق.
// /api/ops/clean-girls كان يحذف الفصول/المواد ويكتب school_data بلا أي تحقق.
// كلاهما يستخدم الآن نفس نمط مسارات الإدارة القائم في المشروع:
//   requireAuth  +  if (req.session.role !== 'ADMIN') return 403
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SERVER_PATH = path.join(__dirname, '..', 'server.js');
const src = fs.readFileSync(SERVER_PATH, 'utf8');

const OPS = ['/api/ops/ensure-girls-admin', '/api/ops/clean-girls'];

function routeDecl(route) {
  const needle = "'" + route + "'";
  const i = src.indexOf(needle);
  assert.ok(i >= 0, 'المسار موجود: ' + route);
  return src.slice(i, i + 200);
}

for (const route of OPS) {
  test(route + ' يستعمل requireAuth', () => {
    const decl = routeDecl(route);
    assert.ok(
      new RegExp("app\\.post\\(\\s*'" + route.replace('/', '\\/') + "'\\s*,\\s*requireAuth").test(src),
      'المسار يجب أن يمر عبر requireAuth'
    );
    assert.ok(decl.includes('requireAuth'), 'requireAuth في قائمة الوسائط');
  });

  test(route + ' يرفض غير المدير بـ403 قبل تنفيذ أي شيء', () => {
    const decl = routeDecl(route);
    assert.ok(
      /req\.session\.role\s*!==\s*'ADMIN'\)\s*return\s*res\.status\(403\)/.test(decl),
      'فحص role ADMIN بـ403'
    );
    // الفحص يجب أن يسبق أول استخدام لـ db (لا تنفيذ قبل التحقق)
    const guardIdx = decl.indexOf("req.session.role !== 'ADMIN'");
    const firstDbIdx = Math.min(
      ...['db.mutateSchoolData', 'db.pool.query', 'bcrypt.hash']
        .map((k) => decl.indexOf(k)).filter((x) => x >= 0)
    );
    assert.ok(firstDbIdx === -1 || guardIdx < firstDbIdx,
      'الفحص قبل أول استدعاء قاعدة بيانات/تشفير');
  });
}

test('requireAuth موجود في قائمة الوسائط لا داخل جسم الدالة', () => {
  for (const route of OPS) {
    const i = src.indexOf("'" + route + "'");
    const line = src.slice(src.lastIndexOf('\n', i) + 1, i + route.length + 40);
    assert.ok(/requireAuth\s*,/.test(line), route + ' — requireAuthPassed كوسيط لا كشرط');
  }
});

test('لم تبقَ أي /api/ops بلا requireAuth', () => {
  const unguarded = [];
  const re = /app\.(get|post|put|delete)\(\s*'(\/api\/ops[^']*)'/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const tail = src.slice(m.index, m.index + m[0].length + 40);
    if (!/requireAuth/.test(tail)) unguarded.push(m[2]);
  }
  assert.deepEqual(unguarded, [], 'كل مسارات /api/ops محمية');
});

test('نمط الحماية يطابق النمط القائم لمسارات الإدارة الأخرى', () => {
  // النموذج المرجعي: requireAuth ثم req.session.role !== 'ADMIN' => 403 forbidden
  const ref = src.slice(src.indexOf("app.post('/api/backups/import'"), src.indexOf("app.post('/api/backups/import'") + 300);
  assert.ok(/requireAuth/.test(ref), 'المرجع يستخدم requireAuth');
  assert.ok(/req\.session\.role\s*!==\s*'ADMIN'\)\s*return\s*res\.status\(403\)\.json\(\{\s*error:\s*'forbidden'\s*\}\)/.test(ref),
    'المرجع يفحص ADMIN بـ403 forbidden');
  for (const route of OPS) {
    const decl = routeDecl(route);
    assert.ok(/res\.status\(403\)\.json\(\{\s*error:\s*'forbidden'\s*\}\)/.test(decl),
      route + ' يستخدم نفس استجابة forbidden');
  }
});

test('لم يُمس منطق mutateSchoolData في هذا التعديل', () => {
  const dbSrc = fs.readFileSync(path.join(__dirname, '..', 'db.js'), 'utf8');
  assert.ok(/async function mutateSchoolData\(school, mutator\)/.test(dbSrc), 'موجود');
  assert.ok(/Math\.max\(Date\.now\(\), storedTs \+ 1\)/.test(dbSrc), 'ts رتيب كما هو');
  assert.ok(/SELECT data, ts FROM school_data WHERE school = \$1 FOR UPDATE/.test(dbSrc), 'FOR UPDATE كما هو');
});

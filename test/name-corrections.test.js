'use strict';
/* =============================================================================
 * حارس «تصحيح أسماء العائلة المثبّت» — تصحيح تلقائي على الخادم والواجهة
 * -----------------------------------------------------------------------------
 * أُبلغ إدارياً عن خطأين إملائيين في لقبين: «جرياري» ← «حرباوي» (شيماء)،
 * و«فتجي» ← «فتحي» (نهلة). يُثبّت هذا الاختبار أن التصحيح مطبَّق في:
 *   - الخادم: عند الكتابة (PUT) وعند القراءة (GET /api/db) وفي sendUser.
 *   - الواجهة: عند قراءة القاعدة (loadDB) — فتظهر صحيحة على أي جهاز.
 * مع اختبار سلوكي فعلي للدالة (لا مجرد بحث نصي).
 * ========================================================================== */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'لم أجد الدالة ' + name);
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('لم يُغلق جسم ' + name);
}

function loadServerFns() {
  const arrStart = SERVER.indexOf('const NAME_CORRECTIONS = [');
  assert.ok(arrStart >= 0, 'NAME_CORRECTIONS مفقود في الخادم');
  const arrEnd = SERVER.indexOf('];', arrStart);
  const arr = SERVER.slice(arrStart, arrEnd + 2);
  const code = arr + '\n' + extractFn(SERVER, 'fixPersonName') + '\n' + extractFn(SERVER, 'fixUsersNames') +
    ';globalThis.__X={fixPersonName,fixUsersNames};';
  const ctx = { globalThis: {} };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return ctx.globalThis.__X;
}

test('1) الخادم: قواعد التصحيح موجودة وتعمل فعلياً', () => {
  assert.ok(SERVER.includes("from: 'جرياري', to: 'حرباوي'"), 'قاعدة شيماء مفقودة');
  assert.ok(SERVER.includes("from: 'فتجي',   to: 'فتحي'"), 'قاعدة نهلة مفقودة');
  const X = loadServerFns();
  assert.strictEqual(X.fixPersonName('شيماء جرياري'), 'شيماء حرباوي');
  assert.equal(X.fixPersonName('شيماء ليث عبد الجبار جرياري'), 'شيماء ليث عبد الجبار حرباوي');
  assert.equal(X.fixPersonName('نهلة فتجي'), 'نهلة فتحي');
  assert.equal(X.fixPersonName('محمد فتحي'), 'محمد فتحي', 'الاسم الصحيح لا يتغيّر');
  assert.equal(X.fixPersonName(''), '');
  assert.equal(X.fixPersonName(null), null);
  const users = [{ id: 'a', name: 'نهلة فتجي' }, { id: 'b', name: 'سالم' }];
  assert.strictEqual(X.fixUsersNames(users), true);
  assert.equal(users[0].name, 'نهلة فتحي');
  assert.equal(users[1].name, 'سالم');
});

test('2) الخادم: يُطبَّق عند الكتابة (PUT) وعند القراءة (GET) وفي sendUser', () => {
  assert.ok(SERVER.includes('fixUsersNames(clean.users)'), 'لا تصحيح عند حفظ بيانات القسم');
  const getSeg = SERVER.slice(SERVER.indexOf("app.get('/api/db/:school'"), SERVER.indexOf("app.get('/api/db/:school'") + 700);
  assert.ok(getSeg.includes('fixUsersNames(rec.data.users)'), 'لا تصحيح عند قراءة بيانات القسم');
  assert.ok(SERVER.includes('name: fixPersonName(u.name)'), 'sendUser لا يصحّح اسم المستخدم');
});

test('3) الواجهة: قواعد مطابقة + تطبيقها في loadDB', () => {
  assert.ok(SRC.includes('const __NAME_CORRECTIONS = ['), '__NAME_CORRECTIONS مفقود');
  assert.ok(SRC.includes("from: 'جرياري', to: 'حرباوي'"), 'قاعدة شيماء في الواجهة مفقودة');
  assert.ok(SRC.includes("from: 'فتجي',   to: 'فتحي'"), 'قاعدة نهلة في الواجهة مفقودة');
  assert.ok(SRC.includes('function __fixPersonName('), '__fixPersonName مفقودة');
  const ld = extractFn(SRC, '__fixPersonName');
  assert.ok(ld.includes("split(c.from).join(c.to)"), 'منطق التصحيح في الواجهة ناقص');
  const lo = SRC.indexOf('function loadDB()');
  const body = SRC.slice(lo, lo + 2500);
  assert.ok(body.includes('__fixPersonName(u.name)'), 'loadDB لا يصحّح أسماء المستخدمين');
});

test('4) نسخ الواجهة: رُفعت بعد التصحيح', () => {
  const v = SRC.match(/const __APP_VER = '([^']+)'/);
  assert.ok(v && v[1].includes('guardian-editor'), 'الإصدار لا يعكس التغيير');
  assert.ok(v[1].includes('name-fix'), 'الإصدار لا يحمل وسم تصحيح الأسماء');
});

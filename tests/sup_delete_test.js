'use strict';

// اختبار مركّز لإصلاح «حذف المشرفة من الإشراف اليومي لا يُحفظ في الخادم».
// نستخرج الكود الحقيقي من public/index.html ونشغّله في vm، ثم نختبر:
//   1) نجاح الحذف: PUT يُرسل + المحذوفة غير موجودة في payload + بقية الأيام سليمة + تحميل الاستجابة.
//   2) فشل HTTP (500): رسالة خطأ + إعادة المشرفة للمسودة + لا يُعتبر الحذف محفوظاً.
//   3) فشل الشبكة (fetch يرمي): لا استثناء غير معالج + إعادة المشرفة + false + بقية الجدول سليم.
//   4) ثبات بعد التحديث: بعد نجاح PUT ثم إعادة تحميل، المحذوفة لا تعود.

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const INDEX_HTML_PATH = path.join(__dirname, '..', 'public', 'index.html');

function extractArrayLiteral(src, marker) {
  const startIdx = src.indexOf(marker);
  if (startIdx === -1) throw new Error(`array not found in index.html: ${marker}`);
  const bracketStart = src.indexOf('[', startIdx);
  let depth = 0;
  let end = bracketStart;
  for (; end < src.length; end++) {
    if (src[end] === '[') depth++;
    else if (src[end] === ']') {
      depth--;
      if (depth === 0) { end++; break; }
    }
  }
  return src.slice(bracketStart, end);
}

function extractFunctionSource(src, marker) {
  const startIdx = src.indexOf(marker);
  if (startIdx === -1) throw new Error(`function not found in index.html: ${marker}`);
  const braceStart = src.indexOf('{', startIdx);
  let depth = 0;
  let end = braceStart;
  for (; end < src.length; end++) {
    if (src[end] === '{') depth++;
    else if (src[end] === '}') {
      depth--;
      if (depth === 0) { end++; break; }
    }
  }
  return src.slice(startIdx, end);
}

function buildSandbox({ fetchImpl }) {
  const src = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
  const ensureDraftSrc = extractFunctionSource(src, 'function __ensureSupervisionDraft(){');
  const saveSrc = extractFunctionSource(src, 'async function __saveSupervisionSchedule(){');
  const removeSrc = extractFunctionSource(src, 'async function __supervisionRemoveTeacher(dow, teacherId){');
  const supervisionDaysSrc = extractArrayLiteral(src, 'const SUPERVISION_DAYS = [');

  const context = {
    __supervisionSchedule: null,
    __supervisionDraftSchedule: null,
    __supervisionAddOpenDay: null,
    renderAppCallCount: 0,
    renderApp: null,
    currentUser: () => ({ role: 'ADMIN' }),
    getActiveSchool: () => 'GIRLS',
    SUPERVISION_API: '/api/supervision/',
    fetch: null,
    alert: null,
    console,
  };
  vm.createContext(context);
  context.alert = msg => { context.lastAlert = msg; };
  context.renderApp = () => { context.renderAppCallCount++; };
  context.fetch = fetchImpl;

  vm.runInContext(`const SUPERVISION_DAYS = ${supervisionDaysSrc};`, context);
  vm.runInContext(ensureDraftSrc, context);
  vm.runInContext(saveSrc, context);
  vm.runInContext(removeSrc, context);

  return context;
}

// قوائم جاهزة: الثلاثاء (dow=2) فيها 4 مشرفات، الاثنين (dow=1) فيها 2.
function seedSchedule() {
  return { schedule: [
    { dayOfWeek: 2, teacherId: 'T-AMAL' },    // أمل الشامي
    { dayOfWeek: 2, teacherId: 'T-HANEEN' },  // حنين العبيدي
    { dayOfWeek: 2, teacherId: 'T-KHADIJA' }, // خديجة محمد
    { dayOfWeek: 2, teacherId: 'T-D' },
    { dayOfWeek: 1, teacherId: 'T-MON1' },
    { dayOfWeek: 1, teacherId: 'T-MON2' },
  ] };
}

test('الحالة 1 — نجاح الحذف: PUT يُرسل، المحذوفة غير موجودة في payload، بقية الأيام سليمة', async () => {
  let putCalls = 0;
  let sentBody = null;
  const ctx = buildSandbox({
    fetchImpl: async (url, opts) => {
      assert.equal(url, '/api/supervision/schedule');
      assert.equal(opts.method, 'PUT');
      putCalls++;
      sentBody = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ schedule: sentBody.schedule }) };
    },
  });
  ctx.__supervisionSchedule = seedSchedule();
  ctx.__ensureSupervisionDraft();

  await ctx.__supervisionRemoveTeacher(2, 'T-AMAL');

  assert.equal(putCalls, 1, 'يجب أن يُرسل PUT للجدول بعد الحذف مباشرة');
  assert.ok(sentBody, 'يجب بناء payload من المسودة');
  assert.equal(sentBody.school, 'GIRLS');
  const tueIds = sentBody.schedule.filter(x => x.dayOfWeek === 2).map(x => x.teacherId);
  const monIds = sentBody.schedule.filter(x => x.dayOfWeek === 1).map(x => x.teacherId);

  assert.ok(!tueIds.includes('T-AMAL'), 'أمل الشامي يجب ألا تكون في payload الثلاثاء');
  for (const id of ['T-HANEEN', 'T-KHADIJA', 'T-D']) assert.ok(tueIds.includes(id), `${id} يجب أن تبقى في الثلاثاء`);
  assert.deepEqual(monIds.sort(), ['T-MON1', 'T-MON2'], 'الاثنين يجب ألا يتغير');

  // استجابة الخادم تُحمّل إلى __supervisionSchedule
  assert.ok(ctx.__supervisionSchedule && ctx.__supervisionSchedule.schedule, 'الاستجابة يجب أن تُحمّل');
  assert.ok(!ctx.__supervisionSchedule.schedule.some(x => x.teacherId === 'T-AMAL'), 'الاستجابة المحمّلة يجب ألا تحتوي المحذوفة');
});

test('الحالة 2 — فشل HTTP (500): رسالة خطأ، إعادة المشرفة، لا يُعتبر الحذف محفوظاً', async () => {
  const ctx = buildSandbox({ fetchImpl: async () => ({ ok: false }) });
  ctx.__supervisionSchedule = seedSchedule();
  ctx.__ensureSupervisionDraft();
  ctx.lastAlert = null;

  const result = await ctx.__supervisionRemoveTeacher(2, 'T-HANEEN');

  assert.equal(result, undefined, 'الدالة لا تتطلب قيمة رجوع معينة؛ التحقق عبر حالة المسودة');
  assert.ok(ctx.lastAlert && ctx.lastAlert.includes('تعذر'), `يجب ظهور رسالة خطأ، كانت: ${ctx.lastAlert}`);
  // الدالة الحفظ ترجع false فقط لل call-site؛ تحقّق من سلوك المسودة
  assert.ok(ctx.__supervisionDraftSchedule[2].has('T-HANEEN'), 'حنين يجب أن تُستعاد للمسودة عند فشل الحفظ');
  assert.equal(ctx.__supervisionDraftSchedule[2].size, 4, 'عدد مشرفي الثلاثاء يجب ألا ينتقص');
  assert.deepEqual([...ctx.__supervisionDraftSchedule[1]], ['T-MON1', 'T-MON2'], 'بقية الأيام سليمة');
});

test('الحالة 3 — فشل الشبكة (fetch يرمي): لا استثناء غير معالج، إعادة المشرفة، false، بقية الجدول سليم', async () => {
  let saveReturnValue = null;
  const ctx = buildSandbox({
    fetchImpl: async () => { throw new TypeError('network down'); },
  });
  ctx.__supervisionSchedule = seedSchedule();
  ctx.__ensureSupervisionDraft();
  ctx.lastAlert = null;

  // الدالة داخل remove تستدعي save؛ نختبر save مباشرة للتحقق من false + عدم رمية
  saveReturnValue = await ctx.__saveSupervisionSchedule();
  assert.equal(saveReturnValue, false, 'يجب أن تُرجع false عند فشل fetch');
  assert.ok(ctx.lastAlert && ctx.lastAlert.includes('تعذر'), 'يجب ظهور رسالة خطأ عند فشل الشبكة');
  assert.notEqual(ctx.__supervisionDraftSchedule, null, 'المسودة يجب ألا تُصفّر عند الفشل');

  // إعادة المشرفة عبر remove: يجب ألا يُرمى أي استثناء
  ctx.__supervisionDraftSchedule = {};
  vm.runInContext('SUPERVISION_DAYS.forEach(day => { __supervisionDraftSchedule[day.dow] = new Set(); });', ctx);
  seedSchedule().schedule.forEach(x => ctx.__supervisionDraftSchedule[x.dayOfWeek].add(x.teacherId));

  let threw = false;
  try {
    await ctx.__supervisionRemoveTeacher(2, 'T-D');
  } catch {
    threw = true;
  }
  assert.equal(threw, false, 'يجب ألا يظهر استثناء غير معالج للمستخدم');
  assert.ok(ctx.__supervisionDraftSchedule[2].has('T-D'), 'المشرفة المحذوفة يجب أن تستعاد عند فشل الشبكة');
  assert.equal(ctx.__supervisionDraftSchedule[2].size, 4, 'عدد مشرفي الثلاثاء لا يتأثر بالفشل');
  assert.deepEqual([...ctx.__supervisionDraftSchedule[1]], ['T-MON1', 'T-MON2'], 'بقية الجدول سليم');
});

test('الحالة 4 — ثبات بعد التحديث: بعد نجاح PUT وإعادة التحميل المحذوفة لا تعود', async () => {
  let sentBody = null;
  const ctx = buildSandbox({
    fetchImpl: async (url, opts) => {
      sentBody = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ schedule: sentBody.schedule }) };
    },
  });
  ctx.__supervisionSchedule = seedSchedule();
  ctx.__ensureSupervisionDraft();

  await ctx.__supervisionRemoveTeacher(2, 'T-KHADIJA');

  // محاكاة إعادة تحميل الصفحة: المسودة تُصفّر وتُعاد من النسخة المخزنة (استجابة الخادم)
  ctx.__supervisionDraftSchedule = null;
  ctx.__ensureSupervisionDraft();

  assert.ok(!ctx.__supervisionDraftSchedule[2].has('T-KHADIJA'), 'خديجة يجب ألا تعود بعد إعادة البناء من نسخة الخادم');
  assert.equal(ctx.__supervisionDraftSchedule[2].size, 3, 'يجب أن تبقى 3 مشرفات في الثلاثاء بعد التحديث');
  assert.deepEqual(ctx.__supervisionDraftSchedule[1].has('T-MON1') && ctx.__supervisionDraftSchedule[1].has('T-MON2'), true, 'بقية الأيام سليمة بعد التحديث');
});
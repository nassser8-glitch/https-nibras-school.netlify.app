'use strict';
/* =============================================================================
 * موثوقية حفظ التكليفات والملاحظات
 * -----------------------------------------------------------------------------
 * العلة الجذرية: كانت الواجهة تُعلن النجاح فور الكتابة في localStorage قبل أي
 * تأكيد من الخادم (alert «تم حفظ التكليف» و banner «حُفظت»)، بينما الرفع مجدول
 * وقد يفشل بلا وضوح — فيظنّ المستخدم أن الحفظ وصل الخادم وهو لم يصل.
 * الإصلاح: طبقة حراسة تربط النجاح/الفشل بنتيجة الرفع الفعلية، مسودة محلية
 * تمنع فقدان النصّ، منع السجلات المكررة عند إعادة المحاولة، مؤشر حالة بأربع
 * حالات، وتحذير عند المغادرة. هذه الاختبارات تقصّ الدوال من الملف المنشور
 * نفسه فلا يمرّ الاختبار بسبب نسخة منفصلة.
 * ========================================================================== */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

function extractFns(name) {
  const start = SRC.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'لم أجد ' + name);
  const open = SRC.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < SRC.length; i++) {
    const ch = SRC[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return SRC.slice(start, i + 1); }
  }
  throw new Error('لم يُغلق جسم ' + name);
}
function newStore() {
  const store = {};
  return {
    store,
    ctx: {
      localStorage: {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; }
      },
      JSON, Set, Array, console
    }
  };
}

// ------------------------------------------------------------------ 1) لا نجاح كاذب
test('1) لا رسالة نجاح فورية للتكليف: النجاح مرتبط بتأكيد الخادم والانتقال بعده', () => {
  assert.ok(!SRC.includes("alert('✅ تم حفظ التكليف')"), 'ما زالت رسالة النجاح الفورية للتكليف');
  assert.ok(!SRC.includes("alert('🗑 تم حذف التكليف')"), 'ما زالت رسالة نجاح الحذف الفورية');
  const i = SRC.indexOf('function saveAssignment(');
  const body = SRC.slice(i, i + 2400);
  assert.ok(body.includes("__saveGuardWatch(getActiveSchool(), 'assignment'"),
    'التكليف لا يُسجّل مراقباً لتأكيد الخادم');
  assert.ok(body.includes('nav()'), 'الانتقال يقع بعد النجاح (لا قبله)');
  assert.ok(body.includes("__noteSaveBanner('🔵 جارٍ حفظ التكليف على الخادم...', false)"),
    'لا مؤشر «جارٍ الحفظ» للتكليف');
});

test('2) لا رسالة نجاح فورية للملاحظة + إصلاح التنبيه المكسور (true)', () => {
  assert.ok(!SRC.includes('__noteSaveBanner(true)'), 'ما زال __noteSaveBanner(true) المكسور');
  assert.ok(SRC.includes("__noteSaveBanner('🔵 جارٍ حفظ الملاحظة على الخادم...', false)"),
    'لا مؤشر «جارٍ الحفظ» للملاحظة');
  assert.ok(SRC.includes("'✅ تم حفظ الملاحظة على الخادم بنجاح.'"),
    'لا رسالة نجاح مؤكدة من الخادم للملاحظة');
  // النجاح يُعلَن من نتيجة الرفع فقط
  assert.ok(SRC.includes('__saveGuardNotify(school, { ok:true })'),
    'النجاح لا يُشتق من نتيجة الرفع الناجحة');
});

// --------------------------------------------------- 3) تصنيف أسباب الفشل (خادم/جلسة/شبكة)
test('3) أسباب الفشل تُصنَّف برسالة مفهومة لكل حالة HTTP', () => {
  const m = SRC.match(/const __SAVE_REASON = \{[\s\S]*?\n\};/);
  assert.ok(m, 'جدول أسباب الفشل مفقود');
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(m[0] + '\n' + extractFns('__saveReasonText') + ';globalThis.R=__saveReasonText;', ctx);
  const R = ctx.R;
  assert.match(R('network:'), /الاتصال/);
  assert.match(R('401'), /الجلسة/);
  assert.match(R('403'), /صلاحية/);
  assert.match(R('500'), /الخادم/);
  assert.match(R('429'), /المحاولة/);
  assert.equal(R(''), '', 'بلا خطأ: لا سبب');
});

// ------------------------------------------- 4) عدم فقدان النصّ: مسودة محلية
test('4) المسودة المحلية: تُكتب وتُقرأ وتُمسح، وقيمة فاسدة لا تكسر', () => {
  const code = [extractFns('__draftKey'), extractFns('__draftSet'), extractFns('__draftGet'), extractFns('__draftClear')].join('\n');
  const { store, ctx } = newStore();
  vm.createContext(ctx);
  vm.runInContext(code + ';globalThis.A={__draftKey,__draftSet,__draftGet,__draftClear};', ctx);
  const A = ctx.A;
  assert.equal(A.__draftKey('note'), 'nibras_draft_note_v1');
  assert.equal(A.__draftGet('note'), null);
  A.__draftSet('note', { cid: 'c1', category: 'الانضباط', description: 'نص مهم' });
  assert.equal(A.__draftGet('note').description, 'نص مهم', 'النصّ محفوظ محلياً');
  assert.equal(A.__draftGet('note').cid, 'c1', 'معرّف الدفعة محفوظ لمنع التكرار');
  A.__draftClear('note');
  assert.equal(A.__draftGet('note'), null, 'المسودة تُمسح بعد النجاح');
  store[A.__draftKey('assignment')] = '{bad json';
  assert.equal(A.__draftGet('assignment'), null, 'مسودة فاسدة تُعامل كغير موجودة');
});

// ------------------------------------------- 5) منع التكرار عند إعادة المحاولة
test('5) إعادة المحاولة لا تُنشئ سجلات مكررة (معرّف ثابت من المسودة)', () => {
  assert.ok(SRC.includes('priorDraft.cid || uid()'), 'الملاحظة لا تعيد استخدام معرّف الدفعة');
  assert.ok(SRC.includes('priorDraft.aid || uid()'), 'التكليف لا يعيد استخدام معرّف السجل');
  assert.ok(SRC.includes('n.batchId === batchId'), 'الملاحظة لا تبحث عن سجل الدفعة نفسه');
  assert.ok(SRC.includes('find(x => x && x.id === aid)'), 'التكليف لا يبحث عن السجل نفسه');
});

// ------------------------------------------- 6) سجل التكليفات المعلّقة (محلي)
test('6) سجل التكليفات المعلّقة: تسجيل بلا تكرار وقراءة وتفريغ', () => {
  const code = [extractFns('__assignUnpushedKey'), extractFns('__assignUnpushedIds'), extractFns('__markAssignUnpushed'), extractFns('__clearAssignUnpushed')].join('\n');
  const { store, ctx } = newStore();
  vm.createContext(ctx);
  vm.runInContext(code + ';globalThis.A={__assignUnpushedKey,__assignUnpushedIds,__markAssignUnpushed,__clearAssignUnpushed};', ctx);
  const A = ctx.A;
  assert.equal(A.__assignUnpushedIds('GIRLS').length, 0);
  A.__markAssignUnpushed('GIRLS', ['a1', 'a2', 'a1']);
  assert.deepEqual(A.__assignUnpushedIds('GIRLS').sort(), ['a1', 'a2'], 'يسجّل ويمنع التكرار');
  assert.equal(A.__assignUnpushedKey('GIRLS'), 'nibras_GIRLS_assign_unpushed_v1');
  assert.equal(A.__assignUnpushedIds('BOYS').length, 0, 'سجل كل مدرسة مستقل');
  store['nibras_GIRLS_assign_unpushed_v1'] = 'not-json';
  assert.deepEqual(A.__assignUnpushedIds('GIRLS'), [], 'قيمة فاسدة = سجل فارغ');
  A.__markAssignUnpushed('GIRLS', ['a3']);
  A.__clearAssignUnpushed('GIRLS');
  assert.equal(A.__assignUnpushedIds('GIRLS').length, 0, 'التفريغ بعد الرفع الناجح');
});

// ------------------------------------------- 7) استمرار المزامنة بعد عودة الاتصال
test('7) محرك الرفع: الدفعة الساقطة تُعاد جدولتها والرفع يُستأنف تلقائياً', () => {
  assert.ok(SRC.includes('if(st.running){ st.dirty = true; return; }'),
    'طلب رفع أثناء رفعٍ جارٍ يُسقط بلا إعادة جدولة');
  assert.ok(SRC.includes('if(st.dirty){ st.dirty = false;'),
    'لا إعادة جدولة للدفعة في finally');
  assert.ok(SRC.includes('setTimeout(() => __syncPush(school), 15000)'),
    'لا إعادة محاولة تلقائية بعد الفشل');
  assert.ok(SRC.includes('function __saveGuardRetry'), 'لا زر إعادة محاولة');
  assert.ok(SRC.includes('__clearAssignUnpushed(school)'),
    'سجل التكليفات المعلّقة لا يُفرَّغ عند الرفع الناجح');
});

// ------------------------------------------- 8) تحذير المغادرة + الرفع عند الإخفاء
test('8) تحذير قبل الإغلاق عند وجود حفظ غير مؤكد + محاولة رفع عند إخفاء الصفحة', () => {
  assert.ok(SRC.includes("window.addEventListener('beforeunload'"), 'لا حارس قبل الإغلاق');
  assert.ok(SRC.includes("document.addEventListener('visibilitychange'"), 'لا رفع عند إخفاء الصفحة');
  const i = SRC.indexOf("window.addEventListener('beforeunload'");
  const body = SRC.slice(i, i + 700);
  assert.ok(body.includes('e.preventDefault()'), 'لا تحذير فعلي قبل المغادرة');
});

// ------------------------------------------- 9) مؤشر الحالة بأربع حالات
test('9) مؤشر الحالة يعكس النتيجة الفعلية (محفوظ/جارٍ/منتظر/فشل)', () => {
  const code = extractFns('__saveStatus');
  const make = (cfg) => {
    const ctx = {
      getActiveSchool: () => 'GIRLS',
      __serverEnabled: () => cfg.server !== false,
      __syncEnabled: () => cfg.sync !== false,
      __pushState: () => ({ running: !!cfg.running, attempts: cfg.attempts || 0 }),
      __PUSH_MAX_ATTEMPTS: 6,
      __unpushedIds: () => new Array(cfg.unpushed || 0).fill('x'),
      __assignUnpushedIds: () => new Array(cfg.aunpushed || 0).fill('x'),
      localStorage: { getItem: () => (cfg.pending ? '1' : null), setItem() {}, removeItem() {} },
      console
    };
    vm.createContext(ctx);
    vm.runInContext(code + ';globalThis.S=__saveStatus;', ctx);
    return ctx.S();
  };
  assert.equal(make({}).code, 'ok', 'لا معلّق: محفوظ على الخادم');
  assert.equal(make({ running: true }).code, 'saving', 'رفع جارٍ: جارٍ الحفظ');
  assert.equal(make({ pending: true }).code, 'pending', 'نسخة معلّقة: بانتظار المزامنة');
  assert.equal(make({ unpushed: 2 }).code, 'pending', 'نقاط بانتظار الرفع: بانتظار المزامنة');
  assert.equal(make({ aunpushed: 1 }).code, 'pending', 'تكليف بانتظار الرفع: بانتظار المزامنة');
  assert.equal(make({ attempts: 6 }).code, 'fail', 'استُنفد السقف: فشل يتطلب إجراءً');
  assert.equal(make({ server: false }).code, 'fail', 'بلا خادم: فشل');
  assert.equal(make({ sync: false }).code, 'fail', 'المزامنة موقوفة: فشل');
  assert.ok(SRC.includes("'saveGuardPanel'"), 'لوحة الفشل مفقودة');
  assert.ok(SRC.includes('إعادة المحاولة'), 'لا زر إعادة محاولة في اللوحة');
  assert.ok(SRC.includes('نسخ النص'), 'لا زر نسخ النص في اللوحة');
});

// ------------------------------------------- 10) الخصوصية لم تُوسَّع
test('10) الخصوصية: المسودة محلية فقط ولا مسار إرسال جديد لنصّ الملاحظة', () => {
  const i = SRC.indexOf('function __saveGuardOutcome(');
  assert.ok(i > 0, 'دالة النتيجة مفقودة');
  const body = SRC.slice(i, i + 1600);
  assert.ok(!body.includes('__api('), 'دالة النتيجة لا ترسل شيئاً للخادم');
  assert.ok(!body.includes('fetch('), 'دالة النتيجة لا ترسل شيئاً للخادم');
  // معيار ظهور الملاحظات قائم ولم يُلمس
  assert.ok(SRC.includes('function NRC_canSeeNote'), 'معيار ظهور الملاحظات مفقود');
});

// ------------------------------------------- 11) بقية الأقسام لم تُمسّ
test('11) بقية الأقسام سليمة: تدفّق المزامنة والدمج كما هو', () => {
  assert.ok(SRC.includes('try{ __clearUnpushed(school); }catch(e){}'),
    'تفريغ سجل الملاحظات عند الرفع الناجح مفقود');
  assert.ok(SRC.includes('function NRC_mergeNotes'), 'دمج الملاحظات في الواجهة مفقود');
  assert.ok(fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8').includes('function mergeSection'),
    'دمج الأقسام في الخادم مفقود');
  assert.ok(SRC.includes('function __syncPull'), 'سحب المزامنة مفقود');
  assert.ok(SRC.includes("ev:'push-ok'"), 'تسجيل الرفع الناجح مفقود');
});

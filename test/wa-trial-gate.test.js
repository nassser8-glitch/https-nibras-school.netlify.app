'use strict';
/* =============================================================================
 * تجربة رسالة واتساب لولي أمر طالبة واحدة فقط (ترف ناصر)
 * -----------------------------------------------------------------------------
 * القصة: تجربة إرسال رسالة واتساب لولي أمر طالبة واحدة فقط، بلا إرسال جماعي
 * وبلا تفعيل رسائل لبقية الطلاب. الإرسال يدويّ من واتساب نفسه — التطبيق يفتح
 * محادثةً مسوّدةً قابلة للتعديل فقط، ولا يرسل شيئاً من تلقاء نفسه.
 * الأمان: الرقم لا يُعرض كنصّ في الصفحة ولا يُسجَّل في console أو رسائل الأخطاء،
 * ويظهر مرة واحدة فقط داخل دالة الفتح.
 * ========================================================================== */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const SW = fs.readFileSync(path.join(ROOT, 'public', 'sw.js'), 'utf8');

const PHONE_TAIL = '568133414';

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

// ---------------------------------------------------------------- 1) بوابة الاسم
test('1) البوابة تقبل «ترف ناصر» وحدها، وترفض كل الطلاب الآخرين وnull', () => {
  const m = SRC.match(/const __WA_TRIAL_STUDENT = '[^']*';/);
  assert.ok(m, 'ثابت اسم الطالبة التجريبية مفقود');
  assert.ok(m[0].includes('ترف ناصر'), 'اسم الطالبة التجريبية غير صحيح');
  const code = m[0] + '\n' + extractFns('__waTrialEnabled');
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(code + ';globalThis.E=__waTrialEnabled;', ctx);
  const E = ctx.E;
  assert.equal(E({ fullName: 'ترف ناصر' }), true, 'الطالبة التجريبية تُقبل');
  assert.equal(E({ name: 'ترف ناصر' }), true, 'ميدان الاسم البديل مقبول');
  assert.equal(E({ fullName: ' ترف ناصر ' }), true, 'المسافات حول الاسم تُتجاهل');
  assert.equal(E({ fullName: 'ترف ناصر القحطاني' }), false, 'اسم أطول ليس هو البوابة');
  assert.equal(E({ fullName: 'منيرة الشهري' }), false, 'طالبة أخرى مرفوضة');
  assert.equal(E({ fullName: 'أخرى' }), false, 'أي طالبة أخرى مرفوضة');
  assert.equal(E(null), false, 'null مرفوض');
  assert.equal(E({}), false, 'سجل بلا اسم مرفوض');
});

// ------------------------------------------------------- 2) الرقم لا يُعرض ولا يُسجَّل
test('2) الرقم يظهر مرة واحدة فقط داخل دالة الفتح، بلا أي سجل أو رسالة خطأ', () => {
  const hits = SRC.split(PHONE_TAIL).length - 1;
  assert.equal(hits, 1, 'الرقم يجب أن يظهر مرة واحدة فقط');
  const i = SRC.indexOf(PHONE_TAIL);
  const fnStart = SRC.indexOf('function __waTrialOpen(');
  const fnEnd = SRC.indexOf('function __refreshPointsView(');
  assert.ok(fnStart !== -1 && i > fnStart && i < fnEnd, 'الرقم ليس داخل دالة الفتح');
  const fn = SRC.slice(fnStart, fnEnd);
  assert.ok(!fn.includes('console.'), 'لا تسجيل للرقم في console');
  assert.ok(!/\d{9,}/.test(fn.replace(PHONE_TAIL, '')), 'لا رقم آخر داخل الدالة');
  assert.ok(fn.includes("alert('تعذّر فتح محادثة واتساب"), 'رسالة خطأ عامة بلا رقم');
  const alertHit = fn.match(/alert\('([^']*)'\)/);
  assert.ok(alertHit && !/\d/.test(alertHit[1]), 'رسالة الخطأ بلا أرقام إطلاقاً');
  assert.ok(!SERVER.includes(PHONE_TAIL), 'الرقم غير موجود في الخادم');
  assert.ok(!SW.includes(PHONE_TAIL), 'الرقم غير موجود في ملف الـservice worker');
});

// ------------------------------------------------- 3) لا إرسال تلقائي — فتح محادثة فقط
test('3) الزر يفتح محادثة wa.me مسوّدة قابلة للتعديل، ولا يرسل شيئاً من التطبيق', () => {
  const fnStart = SRC.indexOf('function __waTrialOpen(');
  const fnEnd = SRC.indexOf('function __refreshPointsView(');
  const fn = SRC.slice(fnStart, fnEnd);
  assert.ok(fn.includes("window.open(url, '_blank', 'noopener')"), 'لا فتح محادثة');
  assert.ok(fn.includes('https://wa.me/'), 'الرابط ليس wa.me');
  assert.ok(fn.includes("encodeURIComponent(text)"), 'الرسالة غير مُرمّزة — قد تنكسر');
  assert.ok(fn.includes('?text='), 'لا نصّ مسوّد قابل للتعديل');
  assert.ok(!fn.includes('fetch('), 'لا طلب شبكة (إرسال تلقائي محتمل)');
  assert.ok(!fn.includes('XMLHttpRequest'), 'لا طلب شبكة (إرسال تلقائي محتمل)');
  // بوابة سلامة ثانية: أي محاولة باسم غير البوابة تُهمَل قبل بناء الرابط
  assert.ok(fn.includes('if(!__waTrialEnabled(s)) return;'), 'لا بوابة داخل دالة الفتح نفسها');
});

// ------------------------------------------ 4) الزر لا يظهر لغير الطالبة التجريبية
test('4) زر واتساب يُرسم فقط عندما تتحقق بوابة الاسم في بطاقة الطالبة', () => {
  assert.ok(SRC.includes("${__waTrialEnabled(s) ? `<button"), 'الزر غير مقيّد بالبوابة');
  const fnS = SRC.indexOf('function showStudentPoints(');
  const fnE = SRC.indexOf('/* ============ المفكرة والتذكير');
  assert.ok(fnS !== -1 && fnE > fnS, 'دالة ملف الطالبة مفقودة');
  const body = SRC.slice(fnS, fnE);
  assert.ok(body.includes("${__waTrialEnabled(s) ? `<button"), 'الزر ليس في ملف الطالبة');
  assert.ok(body.includes('overlay.innerHTML'), 'الزر ليس في نافذة ملف الطالبة');
  assert.ok(body.includes('✕ إغلاق'), 'الزر ليس في رأس نافذة ملف الطالبة');
  assert.ok(body.includes("__waTrialOpen('${escapeHtml(s.id)}')"), 'الزر لا يفتح المحادثة بالتعريف');
});

// ------------------------------------------------- 5) لا إرسال جماعي ولا تفعيل للبقية
test('5) لا واجهة إرسال جماعي ولا أي مسار إرسال لبقية الطلاب', () => {
  assert.ok(!SRC.includes('function __waTrialBroadcast'), 'لا دالة إرسال جماعي');
  assert.ok(!SRC.includes('wa.me') || SRC.split('wa.me').length - 1 === 1,
    'لا أكثر من رابط واتساب واحد');
  assert.ok(!SRC.includes('function __waTrialAll'), 'لا تفعيل رسائل لبقية الطلاب');
  // وجود حقل guardianPhone للعرض/التحرير مسموح به، لكنه لا يفتح الباب:
  // بوابة الزر ما زالت اسمية بالكامل ولا تعتمد على وجود رقم.
  const gate = extractFns('__waTrialEnabled');
  assert.ok(!/guardianPhone|studentPhone/.test(gate),
    'بوابة الزر اعتمدت على رقم الهاتف — يجب أن تبقى اسمية فقط');
  assert.ok(SRC.includes("return nm === __WA_TRIAL_STUDENT;"),
    'بوابة الاسم لم تعد هي الحاسمة');
});

// ------------------------------------------------- 6) صحة البناء (لا يكسر بقية الشاشات)
test('6) تعديلات الميزة لا تكسر باقي أجزاء الصفحة', () => {
  assert.ok(SRC.includes('function studentNameLink(s, pts){'), 'studentNameLink مفقودة');
  assert.ok(SRC.includes('function __refreshPointsView(studentId){'), 'دالة عرض النقاط مفقودة');
  const i1 = SRC.indexOf('const __WA_TRIAL_STUDENT');
  const i2 = SRC.indexOf('function __waTrialEnabled(');
  const i3 = SRC.indexOf('function __waTrialOpen(');
  const i4 = SRC.indexOf('function __refreshPointsView(');
  assert.ok(i1 !== -1 && i2 !== -1 && i3 !== -1 && i4 !== -1, 'دوال الميزة مفقودة');
  assert.ok(i1 < i2 && i2 < i3 && i3 < i4, 'ترتيب تعريف دوال الميزة غير سليم');
});

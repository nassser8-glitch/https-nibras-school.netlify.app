'use strict';
/* =============================================================================
 * إرسال واتساب لولي أمر الطالبة
 * -----------------------------------------------------------------------------
 * القصة: لكل طالبة لها رقم ولي أمر محفوظ (guardianPhone) زر يفتح محادثة واتساب
 * برقمها نفسه — للإدارة/الوكيل/الإرشاد فقط، ولا زر للمعلمة ولا للطالبة.
 * الإرسال يدويّ من واتساب نفسه: التطبيق يفتح محادثةً مسوّدةً قابلة للتعديل فقط،
 * ولا يرسل شيئاً من تلقاء نفسه لهذا الزر الفردي.
 * ملاحظة: أُضيفت لاحقاً خدمة «الرسائل الجماعية عبر واتساب» (صفحة #/broadcast)
 * بطلب إداري صريح، وهي مقيّدة بالموافقة الموثّقة وصلاحية الخادم — انظر
 * test/whatsapp-broadcast.test.js. لذلك لم يعد هذا الملف يؤكّد انعدام أي إرسال جماعي.
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

// يبني سياقاً حقيقياً: دوالّ الصلاحيات من التطبيق نفسه (لا نسخة مبسّطة)
function buildContext(user) {
  const code = [
    extractFns('isManager'),
    extractFns('isAdminRole'),
    extractFns('isAdminCadre'),
    "function currentUser(){ return __U; }",
    extractFns('__waIntl'),
    extractFns('studentPhone'),
    extractFns('__waGuardianEnabled'),
  ].join('\n');
  const ctx = { __U: user, console };
  vm.createContext(ctx);
  vm.runInContext(code + ';globalThis.E=__waGuardianEnabled;', ctx);
  return ctx;
}

const ADMIN = { role: 'ADMIN' };
const AGENT = { role: 'AGENT' };
const COUNSELOR = { role: 'COUNSELOR' };
const ADMINISTRATIVE = { role: 'ADMINISTRATIVE' };
const SCHOOL_AGENT = { role: 'SCHOOL_AGENT' };
const TEACHER = { role: 'TEACHER' };
const STUDENT = { role: 'STUDENT' };

// ------------------------------------------------ 1) البوابة: رقم محفوظ + إدارة
test('1) الزر يظهر فقط لجزء إداري عندما يكون للطالبة رقم محفوظ', () => {
  const E = buildContext(ADMIN).E;
  assert.equal(E({ guardianPhone: '966500000000' }), true, 'إداري + رقم = يُقبل');
  assert.equal(E({ whatsapp: '966500000000' }), true, 'حقل whatsapp القديم يُقبل');
  assert.equal(E({}), false, 'بلا رقم = مرفوض');
  assert.equal(E({ guardianPhone: '' }), false, 'رقم فارغ = مرفوض');
  assert.equal(E(null), false, 'null مرفوض');

  assert.equal(buildContext(AGENT).E({ guardianPhone: '966500000000' }), true, 'الوكيل يُقبل');
  assert.equal(buildContext(COUNSELOR).E({ guardianPhone: '966500000000' }), true, 'الإرشاد يُقبل');
  assert.equal(buildContext(ADMINISTRATIVE).E({ guardianPhone: '966500000000' }), true, 'المساعدة الإدارية تُقبل');
  assert.equal(buildContext(SCHOOL_AGENT).E({ guardianPhone: '966500000000' }), true, 'وكيلة الشؤون المدرسية تُقبل');

  // الأهم: المعلمة والطالبة لا ترى الزر أبداً حتى لو وُجد رقم
  assert.equal(buildContext(TEACHER).E({ guardianPhone: '966500000000' }), false, 'المعلمة مرفوضة');
  assert.equal(buildContext(STUDENT).E({ guardianPhone: '966500000000' }), false, 'الطالبة مرفوضة');
  assert.equal(buildContext(null).E({ guardianPhone: '966500000000' }), false, 'زائر مرفوض');
});

// ------------------------------------------------ 2) الرقم المستخدم رقم الطالبة نفسه
test('2) دالة الفتح تبني الرابط من رقم الطالبة نفسه، لا من رقم ثابت', () => {
  const fn = extractFns('__waGuardianOpen');
  assert.ok(fn.includes('const phone = studentPhone(s);'), 'لا تقرأ رقم الطالبة');
  assert.ok(fn.includes("'https://wa.me/' + phone"), 'الرابط لا يستخدم رقم الطالبة');
  // لا رقم مكتوب يدوياً في الكود (لا رقم ترف أو غيره)
  assert.ok(!/\d{9,}/.test(fn.replace(/studentPhone|escapeHtml/g, '')), 'يوجد رقم مكتوب يدوياً');
});

// ------------------------------------------------ 3) فتح مسوّدة فقط بلا إرسال تلقائي
test('3) تفتح محادثة wa.me مسوّدة قابلة للتعديل ولا ترسل شيئاً', () => {
  const fn = extractFns('__waGuardianOpen');
  assert.ok(fn.includes("window.open(url, '_blank', 'noopener')"), 'لا فتح محادثة');
  assert.ok(fn.includes('encodeURIComponent(text)'), 'الرسالة غير مُرمّزة');
  assert.ok(fn.includes('?text='), 'لا نصّ مسوّد قابل للتعديل');
  assert.ok(!fn.includes('fetch('), 'لا طلب شبكة');
  assert.ok(!fn.includes('XMLHttpRequest'), 'لا طلب شبكة');
  assert.ok(fn.includes('if(!__waGuardianEnabled(s)) return;'), 'لا بوابة داخل الفتح');
});

// ------------------------------------------------ 4) الزر في ملف الطالبة والقائمة
test('4) الزر يُرسم في بطاقة الطالبة وفي قائمة الطلاب بالقائمة الإدارية', () => {
  assert.ok(SRC.includes('${__waGuardianEnabled(s) ? `<button'), 'الزر غير مقيّد بالبوابة');
  const fnS = SRC.indexOf('function showStudentPoints(');
  const fnE = SRC.indexOf('/* ============ المفكرة والتذكير');
  const body = SRC.slice(fnS, fnE);
  assert.ok(body.includes('${__waGuardianEnabled(s) ? `<button'), 'الزر ليس في ملف الطالبة');
  assert.ok(body.includes("__waGuardianOpen('${escapeHtml(s.id)}')"), 'الزر لا يفتح المحادثة');

  const ph = extractFns('studentPhoneHTML');
  assert.ok(ph.includes('__waGuardianOpen('), 'لا زر واتساب في قائمة الطلاب');
  assert.ok(ph.includes('isAdminCadre('), 'زر القائمة غير مقيّد بالكادر الإداري');
});

// ------------------------------------------------ 5) لا إرسال جماعي أعمى
test('5) الإرسال الجماعي مقيّد بالموافقة وصلاحية الخادم (لا إرسال أعمى)', () => {
  assert.ok(!SRC.includes('function __waSendAll'), 'لا إرسال لكل الطلاب بلا ضوابط');
  // الخدمة الجماعية الجديدة موجودة ومربوطة بالموافقة والصلاحية
  assert.ok(SRC.includes('function renderBroadcast('), 'واجهة الإرسال الجماعي مفقودة');
  assert.ok(SRC.includes('canBroadcastWa('), 'بوابة صلاحية الإرسال الجماعي مفقودة');
  assert.ok(SRC.includes('waConsent'), 'الإرسال الجماعي لا يشترط موافقة موثّقة');
  // روابط wa.me في مواضعها المعدودة فقط (الفردي + اليدوي الجماعي + وصف الواجهة)
  const n = SRC.split('wa.me').length - 1;
  assert.ok(n >= 2 && n <= 6, 'عدد روابط واتساب غير متوقّع: ' + n);
  // لا رقم ثابت مسرّب إلى الخادم أو الـservice worker
  assert.ok(!/\b9665\d{8}\b/.test(SERVER), 'رقم مسرّب في الخادم');
  assert.ok(!/\b9665\d{8}\b/.test(SW), 'رقم مسرّب في الـservice worker');
});

// ------------------------------------------------ 6) صحة البناء
test('6) الميزة لا تكسر بقية أجزاء الصفحة', () => {
  assert.ok(SRC.includes('function studentNameLink(s, pts){'), 'studentNameLink مفقودة');
  assert.ok(SRC.includes('function __refreshPointsView(studentId){'), 'دالة نقاط مفقودة');
  const i1 = SRC.indexOf('function __waGuardianEnabled(');
  const i2 = SRC.indexOf('function __waGuardianOpen(');
  const i3 = SRC.indexOf('function __refreshPointsView(');
  assert.ok(i1 !== -1 && i2 !== -1 && i3 !== -1, 'دوال الميزة مفقودة');
  assert.ok(i1 < i2 && i2 < i3, 'ترتيب تعريف دوال الميزة غير سليم');
  assert.ok(!SRC.includes('__waTrial'), 'بقايا الميزة التجريبية القديمة ما زالت موجودة');
});

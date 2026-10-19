'use strict';
/* =============================================================================
 * حارس «لا نجاح قبل تأكيد الخادم» — حفظٌ ثم انتقال فوريّ لا يضيّع البيانات
 * -----------------------------------------------------------------------------
 * القصة: «أول حفظ يضيع، ثم إن انتظرت ثوانٍ ينجح». السبب الجذري المرصود:
 *   1) saveAttendance كان (أ) يُعلن «تم حفظ الحضور بنجاح» فوراً وبلا شرط قبل
 *      تأكيد الخادم، و(ب) يرفع عبر fetch خام يتجاوز __syncPush (دمج/تصادم/أمان/
 *      نسخة احتياطية)، و(ج) عند الفشل يلجأ لجدولة ثابتة 4000ms — وهي بالضبط
 *      «ثوانٍ» الانتظار التي كان الحفظ ينجح بعدها.
 *   2) الاحتياطي (pendKey) كان يُكتب عند فشل الرفع فقط؛ فمن أغلق/انتقل خلال نافذة
 *      الجدولة (700ms) قبل بدء الرفع لم يُكتب له احتياطي — فتبقى النقاط محلية بلا رفع.
 * يثبّت هذا الاختبار القواعد الجديدة: رفعٌ موحّد، نجاحٌ مؤجَّل حتى تأكيد الخادم،
 * ومنعُ الإرسال المكرر، وتثبيتُ الاحتياطي عند المغادرة/الإخفاء.
 * ========================================================================== */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

function extractFn(name, src) {
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

test('1) saveAttendance: لا رفع خام ولا تأخير ثابت — رفعٌ عبر __syncPush مع مراقبة النتيجة', () => {
  const att = extractFn('saveAttendance', SRC);
  assert.ok(!att.includes('fetch(SYNC_API'), 'ما زال يرفع عبر fetch خام يتجاوز محرك المزامنة');
  assert.ok(!/,\s*4000\s*\)/.test(att), 'ما زال يستعمل تأخيراً ثابتاً (4000ms) — أصل «ينجح بعد ثوانٍ»');
  assert.ok(att.includes("__saveGuardWatch(schoolNow, 'attendance', __saveGuardOutcome)"),
    'لا يتابع تأكيد الخادم عبر حارس الحفظ');
  assert.ok(att.includes('__syncSchedule(schoolNow, 0)'), 'لا يستدعي جدولة الرفع الموحّدة');
});

test('2) saveAttendance: لا «نجاح كاذب» — الرسالة الفورية صارت «جارٍ الحفظ» ما دام الرفع على الخادم', () => {
  const att = extractFn('saveAttendance', SRC);
  assert.ok(att.includes('willSync'), 'غياب تمييز حالة الرفع عن الحفظ المحلي');
  assert.ok(att.includes('__noteSaveBanner'), 'لا شريط «جارٍ الحفظ» على الخادم');
  assert.ok(att.includes('__refreshSaveStatus('), 'لا تحديث لمؤشر حالة الحفظ');
  // الرسالة الفورية للحالة المتزامنة يجب أن تكون «جارٍ...» لا نجاحاً نهائياً
  assert.ok(/جارٍ حفظ الحضور على الخادم/.test(att), 'لا رسالة «جارٍ الحفظ» الفورية');
  assert.ok(att.indexOf('willSync') < att.lastIndexOf('جارٍ'), 'ترتيب إعلان الحالة غير صحيح');
});

test('2ب) saveAttendance: منع الإرسال المكرر بالنقر المتتابع', () => {
  const att = extractFn('saveAttendance', SRC);
  assert.ok(att.includes('saveAttendance._busy'), 'لا وجود لحارس منع الإرسال المكرر');
  assert.ok(/if\(saveAttendance\._busy\)\s*return;/.test(att), 'لا يتجاهل النقرة المكررة أثناء الحفظ');
});

test('2ج) saveAttendance: يحفظ النص الكامل للحضور (تأكل الاختبارات الأخرى هذا الشرط)', () => {
  const att = extractFn('saveAttendance', SRC);
  assert.ok(att.includes('attendanceState.tDraft || {}'), 'فقد تدرّج كشف المعلمين');
  assert.ok(att.includes('u.absences = u.absences || []'), 'فقد تهيئة غياب المعلمة');
  assert.ok(att.includes('u.markedLate = u.markedLate || []'), 'فقد تهيئة تأخر المعلمة');
});

test('3) editStudentPhone: تعديل الرقم يتابع تأكيد الخادم (لا دفع صامت)', () => {
  const fn = extractFn('editStudentPhone', SRC);
  assert.ok(fn.includes("__saveGuardWatch(schoolNow, 'phone', __saveGuardOutcome)"),
    'لا يتابع نتيجة رفع رقم ولي الأمر');
  assert.ok(fn.includes("__noteSaveBanner('🔵 جارٍ حفظ رقم ولي الأمر على الخادم...', false)"),
    'لا مؤشر «جارٍ الحفظ» لتعديل الرقم');
  assert.ok(fn.includes('__syncSchedule(schoolNow, 0)'), 'لا يجدول الرفع');
  assert.ok(fn.includes('guardianPhoneAt'), 'فقد الختم الزمني للرقم');
  assert.ok(fn.includes('isAdminCadre('), 'فقدت بوابة الصلاحية');
});

test('4) __syncPush: يعيد نتيجة الرفع بدل undefined', () => {
  assert.ok(SRC.includes('return { ok:true };'), 'نجاح الرفع لا يعيد نتيجة');
  assert.ok(SRC.includes('return { ok:false, err:lastErr, attempts:st.attempts };'),
    'فشل الرفع لا يعيد سبباً/عدد محاولات');
  assert.ok(SRC.includes('return { ok:false, skipped:true, empty:true };'),
    'مسار الفراغ لا يعيد حالة صريحة');
});

test('5) تثبيت الاحتياطي عند المغادرة/الإخفاء (لا ضياع خلال نافذة الجدولة)', () => {
  assert.ok(SRC.includes('function __persistPendingNow(school)'), 'دالة تثبيت الاحتياطي مفقودة');
  assert.ok(SRC.includes("localStorage.setItem(pendKey, local)"), 'لا تكتب نسخة معلّقة');
  const bu = SRC.indexOf("window.addEventListener('beforeunload'");
  const body = SRC.slice(bu, bu + 900);
  assert.ok(body.includes('__persistPendingNow(school)'), 'beforeunload لا يثبّت الاحتياطي');
  assert.ok(SRC.includes("window.addEventListener('pagehide'"), 'لا تثبيت عند pagehide');
});

test('6) تسميات الحفظ تشمل الحضور ورقم ولي الأمر', () => {
  assert.ok(SRC.includes("'attendance':"), 'لا تسمية للحضور في __SAVE_LABEL');
  assert.ok(SRC.includes("'phone':"), 'لا تسمية لرقم ولي الأمر في __SAVE_LABEL');
  assert.ok(SRC.includes('✅ تم حفظ الحضور على الخادم بنجاح.'), 'نص نجاح الحضور المؤجَّل مفقود');
  assert.ok(SRC.includes('✅ تم حفظ رقم ولي الأمر على الخادم بنجاح.'), 'نص نجاح الرقم المؤجَّل مفقود');
});

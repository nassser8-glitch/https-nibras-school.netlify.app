'use strict';
/* =============================================================================
 * رقم موبايل ولي الأمر — حقل موحّد واحد للطريقتين
 * -----------------------------------------------------------------------------
 * القصة: يمكن إدخال رقم ولي الأمر إما بكتابة الطالبة يدوياً (حقل في نموذج
 * الإضافة) أو باستيراد ملف Excel لأولياء الأمور. الطريقتان تكتبان في الحقل
 * نفسه guardianPhone حتى لا تتفرّع الأرقام في حقلين مختلفين، وتُحذف النسخة
 * القديمة whatsapp بعد التوحيد.
 * الخصوصية: الرقم لا يظهر للمعلمة ولا للطالبة — عرضه وتعديله مقصوران على
 * الإدارة/الوكيل/الإرشاد فقط، والتعديل بوابة صلاحية داخل الدالة نفسها.
 * ========================================================================== */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

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

// ------------------------------------------------ 1) توحيد الحقل في الطريقتين
test('1) الإضافة اليدوية والاستيراد يكتبان في guardianPhone نفسه', () => {
  const add = extractFns('addStudent');
  assert.ok(add.includes('guardianPhone'), 'نموذج الإضافة لا يكتب guardianPhone');
  assert.ok(add.includes("replace(/\\D/g,'") || add.includes('replace(/\\D/g, "")'),
    'الرقم لا يُنظَّف من الرموز');

  const imp = SRC.slice(SRC.indexOf('function importStudents('));
  assert.ok(imp.includes('guardianPhone'), 'الاستيراد لا يكتب guardianPhone');
  assert.ok(!/found\.whatsapp\s*=/.test(imp), 'الاستيراد ما زال يكتب في whatsapp القديم');
  assert.ok(imp.includes('delete found.whatsapp'), 'الاستيراد لا يحذف whatsapp المكرر');
});

// ------------------------------------------------ 2) قراءة موحّدة مع تراجع
test('2) studentPhone تقرأ guardianPhone وتتراجع إلى whatsapp القديم', () => {
  const fn = extractFns('studentPhone');
  assert.ok(fn.includes('guardianPhone'), 'لا تقرأ guardianPhone');
  assert.ok(fn.includes('whatsapp'), 'لا تتراجع إلى whatsapp القديم');
  assert.ok(fn.includes('replace(/\\D/g'), 'لا تنظّف الرقم من الرموز');
  // محاكاة حقيقية لسلوك الدالة
  const sandbox = { studentPhone: null };
  new (require('vm').Script)(fn + '\nstudentPhone = studentPhone;').runInNewContext(sandbox);
  assert.equal(sandbox.studentPhone({ guardianPhone: '966-56 8133414' }), '966568133414');
  assert.equal(sandbox.studentPhone({ whatsapp: '966500000000' }), '966500000000');
  assert.equal(sandbox.studentPhone({}), '');
  assert.equal(sandbox.studentPhone(null), '');
});

// ------------------------------------------------ 3) الخصوصية: الإدارة فقط
test('3) العرض والتعديل مقصوران على الإدارة/الوكيل/الإرشاد', () => {
  const html = extractFns('studentPhoneHTML');
  assert.ok(html.includes('isManager('), 'العرض غير مقيّد بصلاحية isManager');
  assert.ok(html.includes('return \'\''), 'لا تُرجع نصاً فارغاً لغير الإدارة');

  const edit = extractFns('editStudentPhone');
  assert.ok(edit.includes('isManager('), 'التعديل غير مقيّد بصلاحية isManager');
  assert.ok(edit.includes('currentUser()'), 'لا تتحقق من المستخدم الحالي');
  assert.ok(edit.includes('saveDB('), 'التعديل لا يحفظ في قاعدة البيانات المعتادة');
});

// ------------------------------------------------ 4) لا بوابة رقم في الواتساب
test('4) بوابة زر الواتساب ما زالت اسمية — رقم الهاتف لا يفتح الباب', () => {
  const gate = extractFns('__waTrialEnabled');
  assert.ok(!/guardianPhone|studentPhone|whatsapp/.test(gate),
    'بوابة الواتساب اعتمدت على رقم الهاتف');
  assert.ok(gate.includes('__WA_TRIAL_STUDENT'), 'البوابة فقدت ثابت الاسم');
});

// ------------------------------------------------ 5) القالب يحمل العمود الصحيح
test('5) قالب Excel يستورد عمود «رقم ولي الأمر» ويكتب guardianPhone', () => {
  const t = SRC.slice(SRC.indexOf('function downloadStudentTemplate('));
  assert.ok(t.includes('رقم ولي الأمر'), 'القالب لا يحمل عمود رقم ولي الأمر');
  const imp = SRC.slice(SRC.indexOf('function importStudents('));
  assert.ok(imp.includes('رقم ولي الأمر'), 'الاستيراد لا يتعرّف على عمود رقم ولي الأمر');
});

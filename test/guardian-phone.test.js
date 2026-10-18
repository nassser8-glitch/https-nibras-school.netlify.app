'use strict';
/* =============================================================================
 * رقم موبايل ولي الأمر — حقل موحّد واحد للطريقتين
 * -----------------------------------------------------------------------------
 * القصة: يمكن إدخال رقم ولي الأمر إما بكتابة الطالبة يدوياً (حقل في نموذج
 * الإضافة) أو باستيراد ملف Excel لأولياء الأمور. الطريقتان تكتبان في الحقل
 * نفسه guardianPhone حتى لا تتفرّع الأرقام في حقلين مختلفين، وتُحذف النسخة
 * القديمة whatsapp بعد التوحيد.
 * الخصوصية: الرقم لا يظهر للمعلمة ولا للطالبة — عرضه وتعديله مقصوران على
 * الكادر الإداري (المدير/الوكيل/الموجهة الطلابية/المساعدة الإدارية/وكيلة الشؤون
 * المدرسية)، والتعديل بوابة صلاحية داخل الدالة نفسها.
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
  // محاكاة حقيقية لسلوك الدالة (مع __waIntl لأن studentPhone تستدعيها)
  const sandbox = { studentPhone: null, __waIntl: null };
  new (require('vm').Script)(extractFns('__waIntl') + '\n' + fn + '\n').runInNewContext(sandbox);
  assert.equal(sandbox.studentPhone({ guardianPhone: '966-56 8133414' }), '966568133414');
  assert.equal(sandbox.studentPhone({ whatsapp: '966500000000' }), '966500000000');
  assert.equal(sandbox.studentPhone({}), '');
  // الصيغة المحلية تُوحَّد إلى دولية عند القراءة — فواتساب لا يقبل 05...
  assert.equal(sandbox.studentPhone({ guardianPhone: '0568133414' }), '966568133414', 'الصيغة المحلية لم تُوحَّد');
  assert.equal(sandbox.studentPhone({ guardianPhone: '568133414' }), '966568133414', 'الصيغة بلا صفر لم تُوحَّد');
  assert.equal(sandbox.studentPhone({ guardianPhone: '00966568133414' }), '966568133414', 'بادئ 00 لم تُزح');
  assert.equal(sandbox.studentPhone({ guardianPhone: '971501234567' }), '971501234567', 'رقم أجنبي برمز دولة آخر لا يُلمس');
  assert.equal(sandbox.studentPhone({ guardianPhone: '0912345678' }), '0912345678', 'رقم غير سعودي (09) لا يُحوَّل');
  assert.equal(sandbox.studentPhone(null), '');
});

// ------------------------------------------------ 3) الخصوصية: الكادر الإداري فقط
test('3) العرض والتعديل مقصوران على الكادر الإداري (لا المعلمة ولا الطالبة)', () => {
  const html = extractFns('studentPhoneHTML');
  assert.ok(html.includes('isAdminCadre('), 'العرض غير مقيّد بصلاحية الكادر الإداري');
  assert.ok(html.includes('return \'\''), 'لا تُرجع نصاً فارغاً لغير الإدارة');

  const edit = extractFns('editStudentPhone');
  assert.ok(edit.includes('isAdminCadre('), 'التعديل غير مقيّد بصلاحية الكادر الإداري');
  assert.ok(edit.includes('currentUser()'), 'لا تتحقق من المستخدم الحالي');
  assert.ok(edit.includes('saveDB('), 'التعديل لا يحفظ في قاعدة البيانات المعتادة');
});

// ------------------------------------------------ 3ب) مصفوفة أدوار الكادر الإداري
test('3ب) الكادر الإداري كله يمرّ والمعلمة والطالبة تُرفضان', () => {
  const vm = require('vm');
  const box = {};
  new vm.Script(extractFns('isAdminRole') + '\n' + extractFns('isAdminCadre') + '\n')
    .runInNewContext(box);
  for(const role of ['ADMIN', 'AGENT', 'COUNSELOR', 'ADMINISTRATIVE', 'SCHOOL_AGENT']){
    assert.equal(box.isAdminCadre({ role }), true, role + ' من الكادر الإداري فيجب أن يمرّ');
  }
  for(const role of ['TEACHER', 'STUDENT']){
    assert.equal(box.isAdminCadre({ role }), false, role + ' ليس من الكادر الإداري فيُرفض');
  }
  assert.equal(box.isAdminCadre(null), false, 'زائر مرفوض');
  assert.equal(box.isAdminCadre({}), false, 'بلا دور مرفوض');
});

// ------------------------------------------------ 4) بوابة الواتساب تعتمد
test('4) بوابة زر الواتساب مقصورة على الكادر الإداري ولا ترسل جماعياً', () => {
  const gate = extractFns('__waGuardianEnabled');
  assert.ok(gate.includes('isAdminCadre('), 'البوابة لا تتحقق من صلاحية الكادر الإداري');
  assert.ok(gate.includes('studentPhone('), 'البوابة لا تتحقق من وجود رقم');
  const open = extractFns('__waGuardianOpen');
  assert.ok(!/fetch\(|XMLHttpRequest/.test(open), 'مسار إرسال تلقائي محتمل');
});

// ------------------------------------------------ 5) القالب يحمل العمود الصحيح
test('5) قالب Excel يستورد عمود «رقم ولي الأمر» ويكتب guardianPhone', () => {
  const t = SRC.slice(SRC.indexOf('function downloadStudentTemplate('));
  assert.ok(t.includes('رقم ولي الأمر'), 'القالب لا يحمل عمود رقم ولي الأمر');
  const imp = SRC.slice(SRC.indexOf('function importStudents('));
  assert.ok(imp.includes('رقم ولي الأمر'), 'الاستيراد لا يتعرّف على عمود رقم ولي الأمر');
});

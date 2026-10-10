'use strict';
/* =============================================================================
 * «آخر نشاطي» للمعلمة: لوحة على شاشتها الرئيسية (مثل رواد نبراس) تعرض آخر
 * ثلاث حركات قامت بها في كل من: التكليفات، التحويلات، الملاحظات.
 * يجب أن تعرض ما فعلته هي فقط (لا تكليفات/تحويلات/ملاحظات معلمات أخريات، ولا
 * العناصر المحذوفة)، وأن تقتصر على أحدث ثلاثة بعد الترتيب تنازلياً.
 * ========================================================================== */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const CLIENT = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

const START = CLIENT.indexOf('function renderTeacherRecent(d, user){');
const END = CLIENT.indexOf('/* ============ أقسام لوحة التحكم: الأنشطة والتقارير', START);
assert.ok(START !== -1 && END > START, 'تعذر قصّ renderTeacherRecent من index.html');
const SRC = CLIENT.slice(START, END);

const TEACHER = { id: 'T1', role: 'TEACHER' };
const STUDENT = { id: 'S1', role: 'STUDENT' };
const MANAGER = { id: 'M1', role: 'MGR' };

function renderWith(doc, user) {
  const students = doc.students || [];
  const ctx = {
    loadDB: () => doc,
    currentUser: () => user,
    escapeHtml: (s) => String(s ?? ''),
    studentById: (id) => students.find(s => s && s.id === id) || null,
    notePoints: (type) => (type === 'POSITIVE' ? 5 : -5),
    console,
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return vm.runInContext('renderTeacherRecent(loadDB(), currentUser())', ctx);
}

const count = (html, re) => ((html || '').match(re) || []).length;

test('غير المعلمة: اللوحة لا تُرسم إطلاقاً', () => {
  assert.equal(renderWith({}, STUDENT), '');
  assert.equal(renderWith({}, MANAGER), '');
  assert.equal(renderWith({}, { id: 'A1', role: 'ADMIN' }), '');
});

test('معلمة بلا بيانات: تُظهر الأقسام الثلاثة بحالة «لا شيء بعد»', () => {
  const html = renderWith({}, TEACHER);
  assert.equal(typeof html, 'string');
  assert.ok(html.includes('آخر نشاطي'), 'يجب أن تظهر لوحة آخر نشاطي');
  for (const t of ['تكليفاتي', 'تحويلاتي', 'ملاحظاتي']) assert.ok(html.includes(t), `يجب أن يظهر قسم ${t}`);
  assert.equal(count(html, /لا شيء بعد/g), 3, 'يجب أن تكون الأقسام الثلاثة «لا شيء بعد»');
  assert.equal(count(html, /عرض الكل/g), 3, 'يجب أن يكون لكل قسم رابط «عرض الكل»');
});

test('تكليفاتي: أحدث ثلاثة تكاليف للمعلمة فقط، بعد استبعاد غير المملوك والمحذوف', () => {
  const students = [{ id: 'stu1' }, { id: 'stu2' }, { id: 'stu3' }];
  const doc = {
    students,
    assignments: [
      { id: 'a1', teacherId: 'T1', classId: 'c1', created: 5, title: 'واحد', type: 'واجب', date: '2026-10-01' },
      { id: 'a2', teacherId: 'T2', classId: 'c1', created: 100, title: 'لغيري', type: 'واجب', date: '2026-10-02' },
      { id: 'a3', teacherId: 'T1', classId: 'c1', created: 4, deleted: true, title: 'محذوف', type: 'واجب', date: '2026-10-03' },
      { id: 'a4', teacherId: 'T1', classId: 'c1', created: 3, title: 'أربعة', type: 'مشروع', date: '2026-10-04' },
      { id: 'a5', teacherId: 'T1', classId: 'c1', created: 2, title: 'خمسة', type: 'حفظ', date: '2026-10-05' },
      { id: 'a6', teacherId: 'T1', classId: 'c1', created: 1, title: 'ستة', type: 'أخرى', date: '2026-10-06' },
      { id: 'a7', teacherId: 'T1', classId: 'c1', created: 6, title: 'سبعة', type: 'واجب', date: '2026-10-07' },
    ],
  };
  const html = renderWith(doc, TEACHER);
  const rows = count(html, /href="#\/assignments\?step=list&cid=/g);
  assert.equal(rows, 3, 'يجب عرض ثلاثة تكاليف فقط');
  assert.ok(html.includes('سبعة') && html.includes('واحد') && html.includes('أربعة'), 'يعرض الأحدث فقط');
  assert.ok(!html.includes('لغيري'), 'لا يعرض تكليفات معلمات أخريات');
  assert.ok(!html.includes('محذوف'), 'لا يعرض التكليف المحذوف');
  assert.ok(!html.includes('خمسة') && !html.includes('ستة'), 'لا يتجاوز الثلاثة الأحدث');
  assert.ok(html.indexOf('سبعة') < html.indexOf('واحد') && html.indexOf('واحد') < html.indexOf('أربعة'), 'مرتب تنازلياً');
  assert.equal(count(html, /لا شيء بعد/g), 2, 'بقية الأقسام بلا شيء');
});

test('تحويلاتي: أحدث ثلاثة تحويلات للمعلمة فقط مع حالة كل منها', () => {
  const doc = {
    transfers: [
      { id: 't1', createdBy: 'T1', createdAt: '2026-10-01T08:00:00.000Z', status: 'PENDING', reason: 'طلب نقل صف' },
      { id: 't2', createdBy: 'T2', createdAt: '2026-10-02T08:00:00.000Z', status: 'PENDING', reason: 'لغيري' },
      { id: 't3', createdBy: 'T1', createdAt: '2026-10-03T08:00:00.000Z', status: 'PENDING', reason: 'محذوف', deleted: true },
      { id: 't4', createdBy: 'T1', createdAt: '2026-09-01T08:00:00.000Z', status: 'RESOLVED', reason: 'تحويل مادة' },
      { id: 't5', createdBy: 'T1', createdAt: '2026-11-01T08:00:00.000Z', status: 'PENDING', reason: 'استئناف نتيجة' },
    ],
  };
  const html = renderWith(doc, TEACHER);
  const rows = count(html, /title="فتح التحويلات"/g);
  assert.equal(rows, 3, 'يجب عرض ثلاثة تحويلات فقط');
  assert.ok(html.includes('استئناف نتيجة') && html.includes('طلب نقل صف') && html.includes('تحويل مادة'), 'يعرض الأحدث فقط');
  assert.ok(!html.includes('لغيري') && !html.includes('محذوف'), 'لا يعرض غير المملوك ولا المحذوف');
  assert.ok(html.indexOf('استئناف نتيجة') < html.indexOf('طلب نقل صف'), 'مرتب تنازلياً');
  assert.ok(html.includes('قيد المتابعة') && html.includes('تمت المعالجة'), 'يُعرض وسم حالة التحويل');
  assert.equal(count(html, /لا شيء بعد/g), 2, 'بقية الأقسام بلا شيء');
});

test('ملاحظاتي: أحدث ثلاث ملاحظات للمعلمة فقط مع النقاط، بعد استبعاد المحذوف وزملائها', () => {
  const students = [{ id: 'stu1', fullName: 'طالبة الأولى' }, { id: 'stu2', fullName: 'طالبة الثانية' }, { id: 'stu3', fullName: 'طالبة الثالثة' }];
  const doc = {
    students,
    notes: [
      { id: 'n1', createdBy: 'T1', studentId: 'stu1', type: 'POSITIVE', category: 'الانضباط', createdAt: '2026-10-01T08:00:00.000Z', points: 5 },
      { id: 'n2', createdBy: 'T1', studentId: 'stu2', type: 'NEGATIVE', category: 'التأخر', createdAt: '2026-11-01T08:00:00.000Z', points: -5 },
      { id: 'n3', createdBy: 'T2', studentId: 'stu3', type: 'POSITIVE', category: 'الانضباط', createdAt: '2026-11-02T08:00:00.000Z', points: 5 },
      { id: 'n4', createdBy: 'T1', studentId: 'stu3', type: 'POSITIVE', category: 'الانضباط', createdAt: '2026-11-03T08:00:00.000Z', deleted: true, points: 5 },
      { id: 'n5', createdBy: 'T1', studentId: 'stu3', type: 'POSITIVE', category: 'المشاركة', createdAt: '2026-09-01T08:00:00.000Z', points: 5 },
    ],
  };
  const html = renderWith(doc, TEACHER);
  const rows = count(html, /title="فتح الملاحظات"/g);
  assert.equal(rows, 3, 'يجب عرض ثلاث ملاحظات فقط');
  assert.ok(html.includes('طالبة الثانية') && html.includes('طالبة الأولى') && html.includes('طالبة الثالثة'), 'يعرض الأحدث فقط');
  assert.ok(html.includes('+5') && html.includes('-5'), 'تُعرض النقاط بإشارتها');
  assert.ok(!html.includes('المشاركة') || html.indexOf('طالبة الثانية') < html.indexOf('طالبة الأولى'), 'مرتب تنازلياً بالتاريخ');
  assert.equal(count(html, /لا شيء بعد/g), 2, 'بقية الأقسام بلا شيء');
});

test('اللوحة محقونة في الواجهة الرئيسية للمعلمة فقط (مثل رواد نبراس)', () => {
  const i = CLIENT.indexOf('function renderDashboard(){');
  assert.ok(i !== -1, 'renderDashboard غير موجود');
  const dash = CLIENT.slice(i, i + 60000);
  assert.ok(dash.includes('renderTeacherRecent(d, user)'), 'يجب استدعاء اللوحة داخل renderDashboard');
  assert.ok(dash.includes("${isTeacher ? renderTeacherRecent(d, user) : ''}"), 'الاستدعاء محجوز للمعلمة فقط');
  assert.ok(dash.indexOf('renderNibrasPioneers(true)') < dash.indexOf('renderTeacherRecent(d, user)'), 'اللوحة تأتي بعد رواد نبراس مباشرة');
});
/* تقريرا الغياب والتأخر كانا يضعان المعلمة والإدارية في سطر واحد.
 *
 * خانة «المعلمون والإداريون» كانت تكتب في عمود «الصف» قيمةً واحدةً
 * «المعلمون والإداريون» لكل الكادر، فالمديرة والمساعد الإدارية والموجهة
 * تُقاسَم المعلمة في العدّ وفي الرسم البياني (الذي يُجمَّع على «الصف»).
 *
 * الإصلاح: عمود «الصف» يحمل اسم المجموعة لا اسم الخانة — «المعلمات»
 * لدور TEACHER و«الكادر الإداري» لبقية الأدوار (الإدارة/الوكيل/الموجه
 * الطلابي/المساعد الإداري/وكيل الشؤون المدرسية)، فيتفرّق الكادران في
 * الجدول وفي الأعمدة والدائرة معًا، ويبقى التاريخ ترتيبًا رئيسيًا.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

function sliceBetween(src, start, end){
  const i = src.indexOf(start);
  assert.ok(i >= 0, 'لم يُعثر على: ' + start);
  const j = end ? src.indexOf(end, i + start.length) : src.length;
  return src.slice(i, j >= 0 ? j : src.length);
}

/* نبني سياقًا حقيقيًا: دوالّ الشيفرة نفسها (بما فيها tl وfeminineLabels
   وcadreGroupLabel وcomputeReportRows) مع loadDB/reportState وهميتين.
   لا نُعيد كتابة المنطق تحت الاختبار، وإلا اختبرنا نسختنا لا نسخة التطبيق. */
function ctx(d, state, user){
  const SRC = [
    'const loadDB = () => __D;',
    'const reportState = __STATE;',
    'const currentUser = () => __USER;',
    'const getActiveSchool = () => "GIRLS";',
    'const getClassesSorted = () => [];',
    'const getVisibleStudents = () => [];',
    'const isManager = (u) => !!(u && (u.role === "ADMIN" || u.role === "AGENT" || u.role === "COUNSELOR"));',
    'const isAdminRole = (r) => (r === "AGENT" || r === "COUNSELOR" || r === "ADMINISTRATIVE" || r === "SCHOOL_AGENT");',
    'const escapeHtml = (s) => String(s == null ? "" : s);',
    sliceBetween(HTML, 'const feminineLabels = {', 'function tl(text)'),
    sliceBetween(HTML, 'function tl(text){', '\nfunction '),
    sliceBetween(HTML, 'function cadreGroupLabel(', '\nfunction computeReportRows'),
    sliceBetween(HTML, 'function computeReportRows()', 'function __cleanupOrphanPointRows(){'),
  ].join('\n');
  return new Function('__D', '__STATE', '__USER', SRC +
    '\nreturn { computeReportRows, cadreGroupLabel };')(d, state, user || { role:'ADMIN', name:'المديرة' });
}

function staff(id, name, role, absences){
  return { id, name, role, active:true, absences: absences || [], markedLate: [] };
}
const DAY = (n) => '2026-10-' + String(n).padStart(2, '0');

test('المعلمات والكادر الإداري يتفرّقان في عمود «الصف» بخانة الكادر', () => {
  const d = { attendance:[], users:[
    staff('T1', 'أمينة', 'TEACHER', [DAY(5)]),
    staff('A1', 'نجود', 'ADMINISTRATIVE', [DAY(5)]),
  ] };
  const rows = ctx(d, { type:'absence', classId:'STAFF', from:'', to:'' }).computeReportRows();
  assert.equal(rows.length, 2, 'سجلّان فقط: معلمة وإدارية');
  const byName = Object.fromEntries(rows.map(r => [r['الطالب'], r['الصف']]));
  assert.equal(byName['أمينة'], 'المعلمات', 'دور TEACHER = «المعلمات»');
  assert.equal(byName['نجود'], 'الكادر الإداري', 'دور ADMINISTRATIVE = «الكادر الإداري»');
  assert.ok(!rows.some(r => r['الصف'] === 'المعلمون والإداريون'),
    'لم يبقَ اسم الخانة في الصفوف — الاسم صار اسم المجموعة');
});

test('كل الأدوار الإدارية في كادرٍ واحد: المدير والوكيل والموجهة ووكيلة الشؤون', () => {
  const d = { attendance:[], users:[
    staff('T1', 'معلمة', 'TEACHER', [DAY(5)]),
    staff('B1', 'مديرة', 'ADMIN', [DAY(5)]),
    staff('B2', 'وكيلة', 'AGENT', [DAY(5)]),
    staff('B3', 'موجهة', 'COUNSELOR', [DAY(5)]),
    staff('B4', 'مساعدة إدارية', 'ADMINISTRATIVE', [DAY(5)]),
    staff('B5', 'وكيلة الشؤون', 'SCHOOL_AGENT', [DAY(5)]),
  ] };
  const rows = ctx(d, { type:'absence', classId:'STAFF', from:'', to:'' }).computeReportRows();
  assert.equal(rows.length, 6, 'كل أدوار الكادر داخل تقرير الكادر');
  assert.equal(rows.filter(r => r['الصف'] === 'المعلمات').length, 1, 'المعلمة وحدها في فريقها');
  assert.equal(rows.filter(r => r['الصف'] === 'الكادر الإداري').length, 5,
    'ADMIN/AGENT/COUNSELOR/ADMINISTRATIVE/SCHOOL_AGENT كلها إدارية');
});

test('التقرير «كل الفصول» يضيف الكادر مفصولًا أيضًا', () => {
  const d = { attendance:[], users:[
    staff('T1', 'أمينة', 'TEACHER', [DAY(7)]),
    staff('A1', 'نجود', 'ADMIN', [DAY(7)]),
  ] };
  const rows = ctx(d, { type:'absence', classId:'', from:'', to:'' }).computeReportRows();
  const staffRows = rows.filter(r => r['الطالب'] === 'أمينة' || r['الطالب'] === 'نجود');
  assert.equal(staffRows.length, 2, 'سجلّا الكادر يدخلان ضمن كل الفصول');
  assert.equal(staffRows.find(r => r['الطالب'] === 'أمينة')['الصف'], 'المعلمات');
  assert.equal(staffRows.find(r => r['الطالب'] === 'نجود')['الصف'], 'الكادر الإداري');
  assert.ok(staffRows.every(r => r['الفصل'] === '—'), 'الكادر لا يتبع فصلًا');
});

test('في التاريخ نفسه تسبق المعلمات الكادر الإداري — والتاريخ يبقى الترتيب الأول', () => {
  const d = { attendance:[], users:[
    staff('A1', 'نجود', 'ADMINISTRATIVE', [DAY(9), DAY(3)]),
    staff('T1', 'أمينة', 'TEACHER', [DAY(9), DAY(3)]),
  ] };
  const rows = ctx(d, { type:'absence', classId:'STAFF', from:'', to:'' }).computeReportRows();
  assert.deepEqual(rows.map(r => r['التاريخ']), [DAY(9), DAY(9), DAY(3), DAY(3)],
    'الأحدث أولًا على الكادر كله — لا يُكسر التسلسل الزمني');
  assert.deepEqual(rows.map(r => r['الصف']),
    ['المعلمات', 'الكادر الإداري', 'المعلمات', 'الكادر الإداري'],
    'وعند تساوي التاريخ تُجمع المعلمات قبل الإداريات');
});

test('تقرير التأخر يفرّق الكادر بالطريقة نفسها ويعرض نوع التأخر', () => {
  const t = staff('T1', 'أمينة', 'TEACHER', []);
  t.markedLate = [DAY(5)]; t.lateMinutes = { [DAY(5)]: 15 }; t.lateType = { [DAY(5)]: 'MORNING' };
  const a = staff('A1', 'نجود', 'ADMINISTRATIVE', []);
  a.markedLate = [DAY(5)]; a.lateMinutes = { [DAY(5)]: 10 };
  const rows = ctx({ attendance:[], users:[t, a] }, { type:'late', classId:'STAFF', from:'', to:'' }).computeReportRows();
  assert.equal(rows.length, 2);
  assert.equal(rows.find(r => r['الطالب'] === 'أمينة')['الصف'], 'المعلمات');
  assert.equal(rows.find(r => r['الطالب'] === 'أمينة')['الحالة'], 'متأخر — تأخر صباحي (15 دقيقة)');
  assert.equal(rows.find(r => r['الطالب'] === 'نجود')['الصف'], 'الكادر الإداري');
  assert.equal(rows.find(r => r['الطالب'] === 'نجود')['الحالة'], 'متأخر (10 دقيقة)');
});

test('الرسم البياني يُجمَّع على «الصف» فيتفرّق الكادران تلقائيًا', () => {
  const cols = sliceBetween(HTML, 'const reportChartCol =', ';');
  assert.ok(/absence:\s*'الصف'/.test(cols), 'غياب يُجمَّع على عمود «الصف»');
  assert.ok(/late:\s*'الصف'/.test(cols), 'تأخر يُجمَّع على عمود «الصف»');
  // بعد الإصلاح يحمل العمود اسم المجموعة، فالشريطان/القطاعان منفصلان
  const d = { attendance:[], users:[
    staff('T1', 'أمينة', 'TEACHER', [DAY(5), DAY(6)]),
    staff('A1', 'نجود', 'ADMINISTRATIVE', [DAY(5)]),
  ] };
  const rows = ctx(d, { type:'absence', classId:'STAFF', from:'', to:'' }).computeReportRows();
  const counts = {};
  rows.forEach(r => { const k = r['الصف'] || '—'; counts[k] = (counts[k] || 0) + 1; });
  assert.deepEqual(counts, { 'المعلمات': 2, 'الكادر الإداري': 1 });
});

test('cadreGroupLabel تكتب ما طُلب بالضبط: «المعلمات» و«الكادر الإداري»', () => {
  const c = ctx({ attendance:[], users:[] }, { type:'absence', classId:'STAFF', from:'', to:'' });
  assert.equal(c.cadreGroupLabel({ role:'TEACHER' }), 'المعلمات');
  assert.equal(c.cadreGroupLabel({ role:'ADMINISTRATIVE' }), 'الكادر الإداري');
  assert.equal(c.cadreGroupLabel({ role:'ADMIN' }), 'الكادر الإداري');
  // بلا role فالوضع الإداري أسلم من إدراجه في المعلمات
  assert.equal(c.cadreGroupLabel({}), 'الكادر الإداري');
});

test('المعلمة غير النشطة والطالبة لا تدخلان تقرير الكادر', () => {
  const d = { attendance:[], users:[
    staff('T1', 'أمينة', 'TEACHER', [DAY(5)]),
    Object.assign(staff('T2', 'موقوفة', 'TEACHER', [DAY(5)]), { active:false }),
    { id:'S1', name:'طالبة', role:'STUDENT', active:true, absences:[DAY(5)], markedLate:[] },
  ] };
  const rows = ctx(d, { type:'absence', classId:'STAFF', from:'', to:'' }).computeReportRows();
  assert.deepEqual(rows.map(r => r['الطالب']), ['أمينة'], 'الغير نشطة والطالبة خارج الكادر');
});

test('الملف سليم و«المعلمون والإداريون» بقيت اسمًا للقائمة لا للصفوف', () => {
  const body = sliceBetween(HTML, 'function cadreGroupLabel(', 'function __cleanupOrphanPointRows(){');
  assert.ok(!body.includes('المعلمون والإداريون'),
    'جسم التقرير لم يعد يكتب اسم الخانة في عمود الصف');
  assert.ok(!/[\u0400-\u04FF\u4e00-\u9fff]/.test(body), 'لا حروف غريبة في جسم التغيير');
  assert.ok(!HTML.includes('\uFFFD'), 'لا محرف تالف');
  // خانة الاختيار ما زالت تصف ما تعرضه فعلاً: كادرًا كاملًا مفصولًا بعمود الصف
  const option = sliceBetween(HTML, '<option value="STAFF"', '</option>');
  assert.ok(option.includes('المعلمون والإداريون'), 'اسم القائمة كما هو — التفرقة في الصفوف');
});

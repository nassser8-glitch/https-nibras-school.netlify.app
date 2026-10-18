/* كشف «الحضور والغياب» كان خيارين: «المعلمون» و«الفصول».
 *
 * وخانة «المعلمون» كانت تخلط الإداريات بالمعلمات (role === 'TEACHER' || isAdminRole)،
 * فالمديرة والوكيلة والموجهة الطلابية والمساعدة الإدارية تُسجَّل حضورُها في كشف المعلمات.
 *
 * الإصلاح: كشفٌ ثالث مستقل «الكادر الإداري» (ADMIN_STAFF) يجمع المدير/الوكيل/الموجهة
 * الطلابية/المساعدة الإدارية/وكيلة الشؤون، ويكشف «المعلمون» يعود للمعلمات وحدهن.
 * السجلّ نفسه (u.absences/markedLate/lateMinutes/lateType عبر tDraft) فلا مسار حفظ جديد.
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
function count(hay, needle){ return hay.split(needle).length - 1; }

/* سياق حقيقي: دوالّ التطبيق نفسها (بما فيها tl وfeminineLabels وisAdminRole) */
function ctx(users){
  const SRC = [
    'const getActiveSchool = () => "GIRLS";',
    sliceBetween(HTML, 'function isAdminRole(', 'function isAdminCadre('),
    sliceBetween(HTML, 'function isAdminCadre(', 'function canManageActivities('),
    'const isManager = (u) => !!(u && (u.role === "ADMIN" || u.role === "AGENT" || u.role === "COUNSELOR"));',
    'const canManageTeachers = (u) => !!(u && (u.role === "ADMIN" || u.role === "AGENT" || u.role === "SCHOOL_AGENT"));',
    sliceBetween(HTML, 'const feminineLabels = {', 'function tl(text)'),
    sliceBetween(HTML, 'function tl(text){', '\nfunction '),
    sliceBetween(HTML, 'function isStaffSheet(', 'function renderAttendance(){'),
  ].join('\n');
  return new Function('__USERS', SRC +
    '\nreturn { isStaffSheet, staffSheetMembers, staffSheetEmptyMsg };')(users);
}

const U = (id, name, role, over) => Object.assign({ id, name, role, active:true, absences:[], markedLate:[] }, over || {});

const PEOPLE = [
  U('t1', 'أمينة', 'TEACHER'),
  U('t2', 'هدى', 'TEACHER'),
  U('a1', 'ناصر', 'ADMIN'),
  U('a2', 'سارة', 'AGENT'),
  U('a3', 'منى', 'COUNSELOR'),
  U('a4', 'هيا', 'ADMINISTRATIVE'),
  U('a5', 'ريم', 'SCHOOL_AGENT'),
  U('s1', 'طالبة', 'STUDENT'),
  U('t9', 'معلمة موقوفة', 'TEACHER', { active:false }),
];

test('الخياران كشفان للكادر معًا، وأي شيء آخر فصل طلاب', () => {
  const c = ctx([]);
  assert.equal(c.isStaffSheet('TEACHERS'), true);
  assert.equal(c.isStaffSheet('ADMIN_STAFF'), true);
  assert.equal(c.isStaffSheet('cls_5a'), false);
  assert.equal(c.isStaffSheet(''), false);
  assert.equal(c.isStaffSheet(null), false);
});

test('كشف «المعلمون» للمعلمات وحدهن — لا إدارية فيه', () => {
  const c = ctx(PEOPLE);
  const names = c.staffSheetMembers({ users: PEOPLE }, 'TEACHERS').map(u => u.name);
  assert.deepEqual(names, ['أمينة', 'هدى'], 'المعلمات النشطات فقط، مرتّبات بالاسم');
  assert.ok(!names.includes('ناصر') && !names.includes('هيا'), 'الإداريات خرجن من كشف المعلمات');
  assert.ok(!names.includes('طالبة') && !names.includes('معلمة موقوفة'), 'الطالبة والموقوفة خارج الكشف');
});

test('كشف «الكادر الإداري» يجمع كل الأدوار الإدارية ويستثني المعلمة والطالبة', () => {
  const c = ctx(PEOPLE);
  const roles = c.staffSheetMembers({ users: PEOPLE }, 'ADMIN_STAFF').map(u => u.role).sort();
  assert.deepEqual(roles, ['ADMIN', 'ADMINISTRATIVE', 'AGENT', 'COUNSELOR', 'SCHOOL_AGENT'],
    'المدير والوكيل والموجهة والمساعدة الإدارية ووكيلة الشؤون');
  const names = c.staffSheetMembers({ users: PEOPLE }, 'ADMIN_STAFF').map(u => u.name);
  assert.ok(!names.includes('أمينة'), 'المعلمة ليست إدارية');
  assert.ok(!names.includes('طالبة'), 'الطالبة ليست إدارية');
});

test('لا فصل بين الكشفين: كل عضو في كشف واحد فقط', () => {
  const c = ctx(PEOPLE);
  const teachers = new Set(c.staffSheetMembers({ users: PEOPLE }, 'TEACHERS').map(u => u.id));
  const admins = new Set(c.staffSheetMembers({ users: PEOPLE }, 'ADMIN_STAFF').map(u => u.id));
  for(const id of teachers) assert.ok(!admins.has(id), id + ' ظهر في الكشفين معًا');
  assert.equal(teachers.size + admins.size, 7, 'المعلمتان + خمس إداريات');
});

test('الترتيب أبجدي عربي داخل كل كشف', () => {
  const c = ctx([U('x1','زينب','ADMIN'), U('x2','أمل','ADMINISTRATIVE'), U('x3','بشرى','AGENT')]);
  const names = c.staffSheetMembers({ users: [U('x1','زينب','ADMIN'), U('x2','أمل','ADMINISTRATIVE'), U('x3','بشرى','AGENT')] }, 'ADMIN_STAFF').map(u => u.name);
  assert.deepEqual(names, ['أمل', 'بشرى', 'زينب']);
});

test('رسالة الفراغ تخصّ كل كشف بما فيه', () => {
  const c = ctx([]);
  assert.equal(c.staffSheetEmptyMsg('ADMIN_STAFF'), 'لا يوجد كادر إداري بعد');
  assert.match(c.staffSheetEmptyMsg('TEACHERS'), /معلم/);
});

test('القائمة تعرض الخيارين تحت بوابة صلاحية واحدة، و«الكادر الإداري» بعدها', () => {
  const select = sliceBetween(HTML, '<select id="attClassId"', '</select>');
  assert.ok(select.includes("canManageTeachers(currentUser())"), 'الخياران تحت بوابة الصلاحية');
  assert.ok(select.includes('value="TEACHERS"'), 'خيار المعلمات');
  assert.ok(select.includes('value="ADMIN_STAFF"'), 'خيار الكادر الإداري');
  assert.ok(select.includes('الكادر الإداري'), 'وبالاسم الطلوب');
  assert.ok(select.indexOf('value="TEACHERS"') < select.indexOf('value="ADMIN_STAFF"'),
    'المعلمات ثم الكادر الإداري ثم الفصول');
  assert.ok(select.indexOf('value="ADMIN_STAFF"') < select.indexOf('${classes.map'),
    'الفصول بعد خيارَي الكادر');
});

test('renderAttendance يحسب كشف الكادر الإداري ويمرّره للقائمة', () => {
  const fn = sliceBetween(HTML, 'function renderAttendance(){', '\nfunction rerenderAttendance(){');
  assert.ok(/isStaffSheet\(attendanceState\.classId\)/.test(fn), 'يُقرّ كشف الكادر بالدالة المشتركة');
  assert.ok(fn.includes("attendanceState.classId === 'ADMIN_STAFF'"), 'يفرّق الكادر الإداري عن المعلمات');
  assert.ok(/const isStaff = isTeachers \|\| isAdminStaff;/.test(fn), 'ويجمعهما لمسار واحد');
  assert.ok(/staffSheetMembers\(d, attendanceState\.classId\)/.test(fn), 'قائمة الكشف من الدالة المشتركة');
  assert.ok(!/u\.role === 'TEACHER' \|\| isAdminRole\(u\.role\)/.test(fn),
    'لم تبقَ القائمة المختلطة القديمة');
  assert.equal(count(fn, '📋 كشف الحضور'), 1, 'سطر الكشف مرة واحدة (لا تكرار عند التعديل)');
  assert.ok(fn.includes("isAdminStaff ? ' — الكادر الإداري'"), 'ترويسة الكشف باسم المجموعة');
  assert.ok(fn.includes('staffSheetEmptyMsg(attendanceState.classId)'), 'رسالة الفراغ حسب الكشف');
});

test('«الغائبون اليوم» وعدّاد الإحصاء يخدمان الكشفين لا المعلمات فقط', () => {
  const abs = sliceBetween(HTML, 'function showAbsentInSheet(){', 'function refreshAttendanceSummary(){');
  assert.ok(abs.includes('isStaffSheet(attendanceState.classId)'), 'غياب الكشف يقرأ كشف الكادر');
  assert.ok(abs.includes('staffSheetMembers(d, attendanceState.classId)'), 'من الدالة المشتركة لا من filtre قديم');
  assert.ok(!abs.includes("u.role === 'TEACHER' && u.active"), 'لا فلترة معلمات مكتوبة داخلًا');

  const sum = sliceBetween(HTML, 'function refreshAttendanceSummary(){', 'function setAttendanceStatus(');
  assert.ok(sum.includes('isStaffSheet(attendanceState.classId)'));
  assert.ok(sum.includes('staffSheetMembers(d, attendanceState.classId)'));
});

test('الحفظ لا يحتاج مسارًا جديدًا: الكادر كله عبر tDraft', () => {
  const save = sliceBetween(HTML, 'function saveAttendance(){', '/* ============ الملاحظات');
  assert.ok(save.includes('attendanceState.tDraft || {}'), 'حفظ الكادر يمرّ على tDraft نفسه');
  assert.ok(/u\.absences = u\.absences \|\| \[\]/.test(save), 'ويُخزَّن على صفة المستخدم');
  assert.ok(/u\.markedLate = u\.markedLate \|\| \[\]/.test(save), 'وكذلك التأخر');
});

test('الملف سليم من الحروف الغريبة والمحارف التالفة', () => {
  const fn = sliceBetween(HTML, 'function isStaffSheet(', 'function renderAttendance(){');
  assert.ok(!/[\u0400-\u04FF\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(fn), 'لا حروف غريبة');
  assert.ok(!HTML.includes('\uFFFD'), 'لا محرف تالف');
});

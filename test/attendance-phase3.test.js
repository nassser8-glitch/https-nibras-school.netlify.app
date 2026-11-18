'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const SERVER_SRC = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const HTML_SRC = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

// استخراج دالة mergeAttendance الحقيقية من server.js
function extractServerFn(name) {
  const start = SERVER_SRC.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'لم يُعثر على ' + name + ' في server.js');
  const open = SERVER_SRC.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < SERVER_SRC.length; i++) {
    const ch = SERVER_SRC[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return SERVER_SRC.slice(start, i + 1); }
  }
  throw new Error('لم يُغلق جسم ' + name);
}

// استخراج دوال index.html
function extractHtmlFn(name) {
  const start = HTML_SRC.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'لم يُعثر على ' + name + ' في public/index.html');
  const open = HTML_SRC.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < HTML_SRC.length; i++) {
    const ch = HTML_SRC[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return HTML_SRC.slice(start, i + 1); }
  }
  throw new Error('لم يُغلق جسم ' + name);
}

function loadServerMerge() {
  const code = extractServerFn('mergeAttendance');
  const ctx = { console, Array, Object, Set, Map, JSON, Math };
  vm.createContext(ctx);
  vm.runInContext(code + '\n; globalThis.mergeAttendance = mergeAttendance;', ctx);
  return ctx.mergeAttendance;
}

function loadHtmlHelpers() {
  const ctx = {
    console,
    Array,
    Object,
    Set,
    Map,
    JSON,
    Math,
    __LEGACY_ABS: '__legacy_abs__',
    __MGR_ABS: '__mgr_abs__',
    currentUser: () => null,
    canRecordPastAttendance: () => false
  };
  vm.createContext(ctx);
  const helpers = [
    extractHtmlFn('__cleanClerkId'),
    extractHtmlFn('__attRealClerks'),
    extractHtmlFn('__attIsAbsent'),
    extractHtmlFn('__attPendingConfirm'),
    extractHtmlFn('__attOverridable'),
    extractHtmlFn('__attEffStatus'),
    extractHtmlFn('__attWinner')
  ].join('\n');
  vm.runInContext(helpers + '\n; globalThis.helpers = { __cleanClerkId, __attRealClerks, __attPendingConfirm, __attOverridable, __attWinner, __attEffStatus };', ctx);
  return { ctx, api: ctx.helpers };
}

test('1. حماية الغياب: تسجيل حاضر من معلم آخر في حصة تالية لا يلغي غياب المعلم الأول مهما كان توقيت الحضور أحدث', () => {
  const serverMerge = loadServerMerge();
  const { api } = loadHtmlHelpers();

  const prevAbsence = [
    { id: 'att-1', studentId: 's101', date: '2026-11-17', status: 'ABSENT', absClerks: ['teacher_1'], createdBy: 'teacher_1', _t: 1000 }
  ];
  // معلم آخر فتح الكشف في حصة تالية وسجل افتراضي حاضر بتوقيت أحدث
  const incomingPresent = [
    { id: 'att-2', studentId: 's101', date: '2026-11-17', status: 'PRESENT', absClerks: [], createdBy: 'teacher_2', _t: 5000 }
  ];

  // فحص الخادم (mergeAttendance) مع جلسة المعلم الثاني
  const serverResult = serverMerge(prevAbsence, incomingPresent, { user_id: 'teacher_2', role: 'TEACHER' });
  assert.equal(serverResult.length, 1);
  assert.equal(serverResult[0].status, 'ABSENT', 'يجب أن يبقى الغياب ولا يُلغى من المعلم الثاني');
  assert.equal(serverResult[0].absClerks.length, 1);
  assert.equal(serverResult[0].absClerks[0], 'teacher_1');

  // فحص العميل (__attWinner)
  const clientWinner = api.__attWinner(prevAbsence[0], incomingPresent[0]);
  assert.equal(clientWinner.status, 'ABSENT', 'في العميل: الغياب يفوز على حضور المعلم الأجنبي');
});

test('2. تصحيح الغياب من صاحب التسجيل: المعلم يستطيع تصحيح الغياب الذي سجله بنفسه إذا كان غير معتمد', () => {
  const serverMerge = loadServerMerge();
  const { api } = loadHtmlHelpers();

  const prevAbsence = [
    { id: 'att-1', studentId: 's101', date: '2026-11-17', status: 'ABSENT', absClerks: ['teacher_1'], createdBy: 'teacher_1', _t: 1000 }
  ];
  // المعلم الأول نفسه أدرك خطأه وسجل تصحيحاً صريحاً بحاضر بتوقيت أحدث
  const selfCorrection = [
    { id: 'att-1', studentId: 's101', date: '2026-11-17', status: 'PRESENT', absClerks: [], createdBy: 'teacher_1', _t: 2000 }
  ];

  const serverResult = serverMerge(prevAbsence, selfCorrection, { user_id: 'teacher_1', role: 'TEACHER' });
  assert.equal(serverResult.length, 1);
  assert.equal(serverResult[0].status, 'PRESENT', 'المعلم صاحب التسجيل يستطيع تصحيح الغياب غير المؤكد');

  const clientWinner = api.__attWinner(prevAbsence[0], selfCorrection[0]);
  assert.equal(clientWinner.status, 'PRESENT', 'في العميل: التصحيح الصريح من صاحب الغياب يفوز');
});

test('3. حماية الغياب المؤكد: الغياب الذي أكده معلمان لا يُلغى إلا بموافقة المعلمين المعنيين أو الإدارة', () => {
  const serverMerge = loadServerMerge();
  const { api } = loadHtmlHelpers();

  const confirmedAbsence = [
    { id: 'att-1', studentId: 's101', date: '2026-11-17', status: 'ABSENT', absClerks: ['teacher_1', 'teacher_2'], createdBy: 'teacher_1', _t: 1000 }
  ];
  // المعلم الأول يحاول منفرداً إلغاء الغياب المؤكد
  const unilateralPresent = [
    { id: 'att-1', studentId: 's101', date: '2026-11-17', status: 'PRESENT', absClerks: [], createdBy: 'teacher_1', _t: 3000 }
  ];

  const serverResult = serverMerge(confirmedAbsence, unilateralPresent, { user_id: 'teacher_1', role: 'TEACHER' });
  assert.equal(serverResult[0].status, 'ABSENT', 'الغياب المؤكد من معلمين اثنين محمي من الإلغاء المنفرد');

  const clientWinner = api.__attWinner(confirmedAbsence[0], unilateralPresent[0]);
  assert.equal(clientWinner.status, 'ABSENT', 'في العميل: الغياب المؤكد يفوز على الإلغاء المنفرد');
});

test('4. الغياب المعتمد إدارياً والسجلات القديمة: لا يعدلها إلا المدير أو صاحب الصلاحية الإدارية', () => {
  const serverMerge = loadServerMerge();
  const { ctx, api } = loadHtmlHelpers();

  // سجل معتمد إدارياً وسجل قديم
  const mgrRecord = { id: 'att-m', studentId: 's101', date: '2026-11-17', status: 'ABSENT', absClerks: ['admin_1', '__mgr_abs__'], createdBy: 'admin_1', _t: 1000 };
  const legacyRecord = { id: 'att-l', studentId: 's102', date: '2026-11-17', status: 'ABSENT', absClerks: ['__legacy_abs__'], _t: 500 };

  // معلم عادي يحاول إلغاء الغياب المعتمد
  const teacherPresent = { id: 'att-m', studentId: 's101', date: '2026-11-17', status: 'PRESENT', absClerks: [], createdBy: 'teacher_1', _t: 2000 };
  const serverTeacherTry = serverMerge([mgrRecord], [teacherPresent], { user_id: 'teacher_1', role: 'TEACHER' });
  assert.equal(serverTeacherTry[0].status, 'ABSENT', 'المعلم العادي لا يستطيع إلغاء غياب معتمد إدارياً');

  // المدير يفك الغياب
  const adminPresent = { id: 'att-m', studentId: 's101', date: '2026-11-17', status: 'PRESENT', absClerks: [], createdBy: 'admin_1', _byAdmin: true, _t: 3000 };
  const serverAdminTry = serverMerge([mgrRecord], [adminPresent], { user_id: 'admin_1', role: 'ADMIN' });
  assert.equal(serverAdminTry[0].status, 'PRESENT', 'المدير يستطيع تعديل وفك الغياب المعتمد');

  // في العميل: تحقق __attOverridable
  assert.equal(api.__attOverridable(mgrRecord, { createdBy: 'teacher_1' }), false, 'المعلم العادي ليس مخولاً بفك غياب الإدارة');
  assert.equal(api.__attOverridable(mgrRecord, { createdBy: 'admin_1', _byAdmin: true }), true, 'المدير مخول بفك غياب الإدارة');
  assert.equal(api.__attOverridable(legacyRecord, { createdBy: 'teacher_1' }), false, 'المعلم العادي ليس مخولاً بفك السجلات القديمة');
  assert.equal(api.__attOverridable(legacyRecord, { createdBy: 'admin_1', _byAdmin: true }), true, 'المدير مخول بفك السجلات القديمة');
});

test('5. توحيد معرفات المعلمين: اعتماد String(id).trim() لمنع التكرار الوهمي والتأكيد الزائف', () => {
  const serverMerge = loadServerMerge();
  const { api } = loadHtmlHelpers();

  // معلم واحد تم إدخال معرفه تارة كرقم 15 وتارة كنص "15" وتارة مع فراغات " 15 "
  const recA = { id: 'att-1', studentId: 's101', date: '2026-11-17', status: 'ABSENT', absClerks: [15], _t: 1000 };
  const recB = { id: 'att-1', studentId: 's101', date: '2026-11-17', status: 'ABSENT', absClerks: ['15', ' 15 '], _t: 1200 };

  const merged = serverMerge([recA], [recB], { user_id: '15', role: 'TEACHER' });
  assert.equal(merged[0].absClerks.length, 1, 'يجب دمج المعرفات المكررة في عنصر واحد فقط');
  assert.equal(merged[0].absClerks[0], '15');

  // التأكد من عدم حدوث تأكيد زائف (clerkCount يجب أن يكون 1 وليس 2 أو 3)
  const clientRealClerks = api.__attRealClerks(merged[0]);
  assert.equal(clientRealClerks.length, 1, 'المعلم نفسه لا يحسب كمعلمين اثنين');
  assert.equal(api.__attPendingConfirm(merged[0]), true, 'يبقى معلقاً بانتظار معلم ثانٍ حقيقي');
});

test('6. حماية التأخر: الحفاظ على دقائق التأخر ونوعه وعدم تحويل الطالب المتأخر إلى غائب', () => {
  const serverMerge = loadServerMerge();
  const { api } = loadHtmlHelpers();

  const lateRecA = { id: 'att-1', studentId: 's101', date: '2026-11-17', status: 'LATE', lateMinutes: 20, _t: 1000 };
  const lateRecB = { id: 'att-1', studentId: 's101', date: '2026-11-17', status: 'LATE', _t: 1500 };

  const merged = serverMerge([lateRecA], [lateRecB], { user_id: 'teacher_1', role: 'TEACHER' });
  assert.equal(merged[0].status, 'LATE');
  assert.equal(merged[0].lateMinutes, 20, 'دقائق التأخر محفوظة ولا تُمسح');

  const clientWinner = api.__attWinner(lateRecA, lateRecB);
  assert.equal(clientWinner.status, 'LATE');
  assert.equal(clientWinner.lateMinutes, 20, 'العميل يحفظ دقائق التأخر عند الدمج');
  assert.equal(api.__attEffStatus(clientWinner), 'LATE', 'الحالة الفعلية للتأخر تظل LATE ولا تتحول لـ ABSENT');
});

test('7. معالجة saveAttendance._busy: استخدام try / finally لضمان تحرير القفل', () => {
  // فحص الكود المصدري في public/index.html
  assert.ok(HTML_SRC.includes('saveAttendance._busy = true;'), 'تعيين القفل موجود');
  assert.match(HTML_SRC, /\}\s*finally\s*\{\s*saveAttendance\._busy\s*=\s*false;\s*\}/, 'تحرير القفل داخل finally مضمون');
});

test('8. ضبط التاريخ: اعتماد تاريخ اليوم افتراضياً واحترام التاريخ المختار صراحة', () => {
  // فحص كود حالة الحضور والتاريخ الافتراضي
  assert.ok(HTML_SRC.includes('userExplicitDate:false'), 'حالة userExplicitDate موجودة في attendanceState');
  assert.match(HTML_SRC, /if\(!attendanceState\.userExplicitDate\s*\|\|\s*!attendanceState\.date\)\{\s*attendanceState\.date\s*=\s*todayStr\(\);/, 'الافتراضي تاريخ اليوم إن لم يختر المستخدم تاريخاً صريحاً');
  assert.ok(HTML_SRC.includes('attendanceState.userExplicitDate=true;'), 'تغيير حقل التاريخ يثبت التاريخ الصريح');
});

test('9. محاكاة تحديث الصفحة F5 وإعادة تشغيل الخادم: بقاء بيانات الحضور دون فقدان', () => {
  const serverMerge = loadServerMerge();

  // الحالة الأولية المخزنة
  let serverDatabase = [
    { id: 'att-1', studentId: 's1', date: '2026-11-17', status: 'ABSENT', absClerks: ['teacher_1'], createdBy: 'teacher_1', _t: 100 },
    { id: 'att-2', studentId: 's2', date: '2026-11-17', status: 'LATE', lateMinutes: 15, createdBy: 'teacher_1', _t: 150 },
    { id: 'att-3', studentId: 's3', date: '2026-11-17', status: 'PRESENT', absClerks: [], createdBy: 'teacher_1', _t: 200 }
  ];

  // محاكاة سحب البيانات بعد تحديث F5
  const clientRefreshed = JSON.parse(JSON.stringify(serverDatabase));
  assert.equal(clientRefreshed.length, 3);
  assert.equal(clientRefreshed.find(x => x.id === 'att-1').status, 'ABSENT');
  assert.equal(clientRefreshed.find(x => x.id === 'att-2').lateMinutes, 15);

  // تأكيد المعلم الثاني للغياب
  const incomingConfirmation = [
    { id: 'att-1', studentId: 's1', date: '2026-11-17', status: 'ABSENT', absClerks: ['teacher_2'], createdBy: 'teacher_2', _t: 300 }
  ];
  serverDatabase = serverMerge(serverDatabase, incomingConfirmation, { user_id: 'teacher_2', role: 'TEACHER' });

  // محاكاة إعادة تشغيل الخادم
  const restartedDb = JSON.parse(JSON.stringify(serverDatabase));
  const s1Rec = restartedDb.find(x => x.studentId === 's1');
  assert.equal(s1Rec.status, 'ABSENT');
  const clerksList = Array.from(s1Rec.absClerks).sort();
  assert.equal(clerksList.length, 2);
  assert.equal(clerksList[0], 'teacher_1');
  assert.equal(clerksList[1], 'teacher_2');
});

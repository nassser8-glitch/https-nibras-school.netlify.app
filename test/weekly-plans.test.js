'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const wp = require(path.join(ROOT, 'weekly-plans.js'));
const db = require(path.join(ROOT, 'db.js'));
const serverSrc = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const indexSrc = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

const sampleSchoolData = {
  grades: [{ id: 'g1', name: 'الأول المتوسط' }],
  classes: [
    { id: 'c1', gradeId: 'g1', name: 'أ', teacherIds: ['t_math', 't_sci', 't_ar'] },
    { id: 'c2', gradeId: 'g1', name: 'ب', teacherIds: ['t_math'] },
  ],
  users: [
    { id: 't_math', name: 'أ. معلم الرياضيات', role: 'TEACHER', active: true },
    { id: 't_sci', name: 'أ. معلم العلوم', role: 'TEACHER', active: true },
    { id: 't_ar', name: 'أ. معلم اللغة العربية', role: 'TEACHER', active: true },
  ],
  timetable: {
    t_math: { sun: { 1: { classId: 'c1', subject: 'الرياضيات' } } },
    t_sci: { sun: { 2: { classId: 'c1', subject: 'العلوم' } } },
    t_ar: { mon: { 1: { classId: 'c1', subject: 'لغتي' } } },
  },
};

test('1-5. تجميع خطط الرياضيات والعلوم والعربية في بوابة موحدة لطالب الفصل نفسه فقط', () => {
  const vMath = wp.validateWeeklyPlanPayload({
    classId: 'c1', subject: 'الرياضيات', weekStart: '2026-11-22', status: 'published',
    items: [
      { id: 'm1', dayKey: 'mon', lesson: 'المعادلات', homework: 'ص 12', links: ['https://example.com/1'] },
      { id: 'm2', dayKey: 'mon', lesson: 'مراجعة إضافية', homework: 'ورقة عمل', attachment: { name: 'ws.pdf', type: 'application/pdf', data: 'data:application/pdf;base64,JVBERi0xLjQ=' } },
    ],
  });
  const vSci = wp.validateWeeklyPlanPayload({
    classId: 'c1', subject: 'العلوم', weekStart: '2026-11-22', status: 'published',
    items: [{ id: 's1', dayKey: 'mon', lesson: 'الخلية', assessments: 'اختبار قصير' }],
  });
  const vAr = wp.validateWeeklyPlanPayload({
    classId: 'c1', subject: 'لغتي', weekStart: '2026-11-22', status: 'published',
    items: [{ id: 'a1', dayKey: 'tue', lesson: 'الفاعل', notes: 'إحضار الدفتر' }],
  });
  assert.equal(vMath.ok && vSci.ok && vAr.ok, true);

  const allPlans = [
    Object.assign({ id: 'p_math', teacherId: 't_math', teacherName: 'أ. معلم الرياضيات' }, vMath.value),
    Object.assign({ id: 'p_sci', teacherId: 't_sci', teacherName: 'أ. معلم العلوم' }, vSci.value),
    Object.assign({ id: 'p_ar', teacherId: 't_ar', teacherName: 'أ. معلم اللغة العربية' }, vAr.value),
  ];

  // طالب من الفصل c1 يرى الخطط الثلاث (4 مهام) مجتمعة في بوابة واحدة
  const unifiedC1 = wp.aggregateUnifiedStudentPlan(allPlans, 'c1', '2026-11-22');
  assert.equal(unifiedC1.subjects.length, 3);
  assert.equal(unifiedC1.tasks.length, 4);

  // طالب من فصل آخر c2 لا يرى خطط c1
  const unifiedC2 = wp.aggregateUnifiedStudentPlan(allPlans, 'c2', '2026-11-22');
  assert.equal(unifiedC2.tasks.length, 0);
});

test('6. صلاحيات المعلم: يقتصر على فصوله المسندة وخططه فقط', () => {
  const assignedSci = wp.extractTeacherAssignments(sampleSchoolData, 't_sci');
  assert.equal(assignedSci.classIds.has('c1'), true);
  assert.equal(assignedSci.classIds.has('c2'), false);
  assert.match(serverSrc, /if \(!assigned\.classIds\.has\(String\(v\.value\.classId\)\)\)/);
  assert.match(serverSrc, /if \(role === 'TEACHER' && String\(existing\.teacherId\) !== uid\)/);
});

test('7. متابعة الإنجاز في الخادم واللوحة الموحدة ولوحة المدير', () => {
  assert.equal(typeof db.setWeeklyPlanItemProgress, 'function');
  assert.equal(typeof db.listStudentWeeklyProgress, 'function');
  assert.equal(typeof db.listPlanWeeklyProgress, 'function');
  assert.match(serverSrc, /app\.post\('\/api\/weekly-plans\/:school\/:id\/items\/:itemId\/progress'/);
  assert.match(serverSrc, /app\.get\('\/api\/weekly-plans\/:school\/:id\/progress'/);

  const cov = wp.buildAdminCoverageSummary(sampleSchoolData, [
    { id: 'p_math', classId: 'c1', subject: 'الرياضيات', teacherId: 't_math', weekStart: '2026-11-22', status: 'published', items: [{ id: '1' }, { id: '2' }] },
  ], '2026-11-22');
  assert.equal(cov.classesWithPlans, 1);
  assert.equal(cov.teachersPublished.length, 1);
  assert.equal(cov.teachersPending.length, 2);
  assert.equal(cov.totalPublishedTasks, 2);
});

test('8 & 9. أرشفة الأسابيع دون تداخل، الظهور في الصفحة الرئيسية، والهوية البصرية', () => {
  const week1 = { id: 'p1', classId: 'c1', subject: 'الرياضيات', weekStart: '2026-11-15', status: 'published', items: [{ id: 'x1', dayKey: 'mon', lesson: 'قديم' }] };
  const week2 = { id: 'p2', classId: 'c1', subject: 'الرياضيات', weekStart: '2026-11-22', status: 'published', items: [{ id: 'x2', dayKey: 'mon', lesson: 'جديد' }] };
  const aggW1 = wp.aggregateUnifiedStudentPlan([week1, week2], 'c1', '2026-11-15');
  const aggW2 = wp.aggregateUnifiedStudentPlan([week1, week2], 'c1', '2026-11-22');
  assert.deepEqual(aggW1.tasks.map(t => t.lesson), ['قديم']);
  assert.deepEqual(aggW2.tasks.map(t => t.lesson), ['جديد']);

  assert.match(indexSrc, /renderStudentWeeklyPlanBanner\(\)/);
  assert.match(indexSrc, /wp-stu-shell/);
  assert.match(indexSrc, /wpOpenArchiveModal/);
  assert.match(indexSrc, /wpOpenFilesModal/);
  assert.match(indexSrc, /wpOpenNotesModal/);
  assert.match(indexSrc, /wp-compact-head/);
  assert.match(indexSrc, /wp-days-stack/);
  assert.match(indexSrc, /wp-day-card/);
  assert.match(indexSrc, /wp-subject-row/);
  assert.match(indexSrc, /wpRenderStudentStatusBadge/);
  assert.doesNotMatch(indexSrc, /wpToggleStudentProgress/);
  assert.match(indexSrc, /تحديد الإنجاز لجميع/);
  assert.match(indexSrc, /wpTeacherBulkCompleteAll/);
  assert.match(indexSrc, /wpTeacherToggleStudentProgress/);
  assert.match(indexSrc, /wpTeacherToggleStudentProgress\(.+?,\s*true\)/);
  assert.match(indexSrc, /wpTeacherToggleStudentProgress\(.+?,\s*false\)/);
  assert.match(indexSrc, /stu\.fullName \|\| stu\.name \|\| stu\.studentName/);
  assert.match(serverSrc, /s\.fullName \|\| s\.name \|\| s\.studentName/);
  assert.match(serverSrc, /class_not_assigned/);
  assert.match(serverSrc, /student_not_in_class/);
  assert.match(serverSrc, /if \(req\.session\.role !== 'TEACHER'\) return res\.status\(403\)/);
  assert.match(serverSrc, /setWeeklyPlanItemProgressBulk/);
  assert.equal(typeof db.setWeeklyPlanItemProgressBulk, 'function');
  assert.deepEqual(wp.WEEK_DAYS.map(d => d.key), ['mon', 'tue', 'wed', 'thu', 'fri']);
  assert.doesNotMatch(indexSrc, /العرض اليومي/);
  assert.match(indexSrc, /لا توجد مهام لهذا اليوم/);
  assert.match(indexSrc, /href:'#\/weekly-plan'/);
  if (db.SCHOOLS[0] === 'GIRLS') {
    assert.match(indexSrc, /\.wp-tab\.active \{ background:#db2777/);
  } else {
    assert.match(indexSrc, /\.wp-tab\.active \{ background:#2563eb/);
  }
});

test('11. منع السبت والأحد، ربط التكليفات من الإثنين للجمعة دون تكرار، وتجميع 5 أيام', () => {
  // منع إنشاء مهمة ليوم الأحد أو السبت
  const badSun = wp.validatePlanItem({ dayKey: 'sun', lesson: 'تجربة' }, 0, '2026-11-22');
  const badSat = wp.validatePlanItem({ dayKey: 'sat', lesson: 'تجربة' }, 0, '2026-11-22');
  assert.equal(badSun.ok, false);
  assert.equal(badSat.ok, false);
  assert.equal(badSun.error, 'invalid_day_key');

  // مهام قديمة تحت sun لا تُعرض في خطة الطالب مع بقائها محفوظة
  const legacyPlan = {
    id: 'p_leg', classId: 'c1', subject: 'الرياضيات', teacherId: 't1', teacherName: 'أ. 1',
    weekStart: '2026-11-22', status: 'published',
    items: [
      { id: 'old_sun', dayKey: 'sun', lesson: 'أحد قديم' },
      { id: 'mon1', dayKey: 'mon', lesson: 'إثنين' },
      { id: 'fri1', dayKey: 'fri', lesson: 'جمعة' },
    ],
  };
  const agg = wp.aggregateUnifiedStudentPlan([legacyPlan], 'c1', '2026-11-22');
  assert.deepEqual(agg.tasks.map(t => t.dayKey), ['mon', 'fri']);

  // ربط التكليفات (الإثنين..الجمعة فقط واستبعاد الأحد والسبت وعدم التكرار)
  const schoolDataWithAssign = Object.assign({}, sampleSchoolData, {
    assignments: [
      { id: 'as1', classId: 'c1', subject: 'العلوم', type: 'تكليف', title: 'تقرير الأربعاء', date: '2026-11-25', teacherId: 't_sci', completedBy: ['stu_1'] },
      { id: 'as1', classId: 'c1', subject: 'العلوم', type: 'تكليف', title: 'تقرير الأربعاء', date: '2026-11-25', teacherId: 't_sci', completedBy: ['stu_1'] }, // مكرر
      { id: 'as_sun', classId: 'c1', subject: 'لغتي', type: 'واجب', title: 'تكليف أحد', date: '2026-11-22', teacherId: 't_ar' },
      { id: 'as_other', classId: 'c2', subject: 'الرياضيات', type: 'واجب', title: 'فصل آخر', date: '2026-11-24', teacherId: 't_math' },
    ],
  });
  const assignRes = wp.extractClassAssignmentsForWeek(schoolDataWithAssign, 'c1', '2026-11-22', 'stu_1');
  assert.equal(assignRes.tasks.length, 1);
  assert.equal(assignRes.tasks[0].dayKey, 'wed');
  assert.equal(assignRes.completedKeys['assign_as1|as1'], true);
  assert.match(serverSrc, /extractClassAssignmentsForWeek/);
});

test('12. بداية الأسبوع من الاثنين في نموذج المعلم وتوافق التواريخ والخطط السابقة', () => {
  assert.match(indexSrc, /بداية الأسبوع \(الاثنين\)/);
  assert.doesNotMatch(indexSrc, /بداية الأسبوع \(الأحد\)/);
  assert.equal(wp.mondayOfDateStr('2026-11-23'), '2026-11-23');
  assert.equal(wp.mondayOfDateStr('2026-11-22'), '2026-11-23');
  assert.equal(wp.weekDateForDay('2026-11-23', 'mon'), '2026-11-23');
  assert.equal(wp.weekDateForDay('2026-11-23', 'fri'), '2026-11-27');

  const pMon = wp.validateWeeklyPlanPayload({
    classId: 'c1', subject: 'الرياضيات', weekStart: '2026-11-23', status: 'published',
    items: [
      { id: 'd1', dayKey: 'mon', lesson: '1' },
      { id: 'd2', dayKey: 'tue', lesson: '2' },
      { id: 'd3', dayKey: 'wed', lesson: '3' },
      { id: 'd4', dayKey: 'thu', lesson: '4' },
      { id: 'd5', dayKey: 'fri', lesson: '5' },
    ],
  });
  assert.equal(pMon.ok, true);
  assert.equal(pMon.value.weekStart, '2026-11-23');
  assert.deepEqual(pMon.value.items.map(i => i.date), ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27']);
});

test('10. تجميع خطط معلمتين أو ثلاث معلمات (سلوم + شادية + ثالثة) لنفس الفصل والأسبوع حتى مع اختلاف يوم حفظ الأسبوع', () => {
  const saloom = {
    id: 'p_saloom', classId: 'c3hs', subject: 'الرياضيات', teacherId: 't_saloom', teacherName: 'سلوم',
    weekStart: '2026-11-22', status: 'published',
    items: [{ id: 'i1', dayKey: 'wed', lesson: 'الدوال' }],
  };
  const shadia = {
    id: 'p_shadia', classId: 'c3hs', subject: 'الفيزياء', teacherId: 't_shadia', teacherName: 'شادية',
    weekStart: '2026-11-23', status: 'published',
    items: [{ id: 'i2', dayKey: 'mon', lesson: 'الكهرباء' }],
  };
  const thirdTeacher = {
    id: 'p_third', classId: 'c3hs', subject: 'الكيمياء', teacherId: 't_third', teacherName: 'نورة',
    weekStart: '2026-11-24', status: 'published',
    items: [{ id: 'i3', dayKey: 'tue', lesson: 'الروابط' }],
  };
  const agg = wp.aggregateUnifiedStudentPlan([saloom, shadia, thirdTeacher], 'c3hs', '2026-11-22');
  assert.equal(agg.plans.length, 3);
  assert.equal(agg.subjects.length, 3);
  assert.deepEqual(agg.tasks.map(t => t.teacherName), ['شادية', 'نورة', 'سلوم']);

  // التأكد أن الخادم يبني قائمة الأسابيع للطالبة من الخطط المنشورة لفصلها فقط
  assert.match(serverSrc, /const allClassPub = await db\.listWeeklyPlans\(school, \{ classId, status: 'published' \}\)/);
  assert.match(serverSrc, /weeklyPlans\.sundayOfDateStr/);
});

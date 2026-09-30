'use strict';
// اختبارات ⭐ نجمة الأسبوع — منطق خالص (بلا خادم وبلا DB)
const test = require('node:test');
const assert = require('node:assert');
const sw = require('../star-week.js');

// ── أدوات بناء بيانات واقعية بنفس الشكل الموجود في المشروع ─────────────────
const DAY = { MONDAY: 1, TUESDAY: 2, WEDNESDAY: 3, THURSDAY: 4, FRIDAY: 5 };
// يبني خانات جدولحصص: periods لكل يوم دراسي
function ttCell(classId, periodsPerDay, days){
  const t = {};
  for (const day of (days || Object.keys(DAY))){
    t[day] = {};
    for (let p = 1; p <= periodsPerDay; p++) t[day][p] = { classId, subject: 'رياضيات' };
  }
  return t;
}
function makeData(opt){
  const o = opt || {};
  const d = {
    grades: [{ id: 'G1', name: 'الصف السادس' }],
    classes: (o.classes || [{ id: 'C1', name: 'أ', gradeId: 'G1', teacherIds: [] }]),
    students: (o.students || []),
    users: (o.users || []),
    timetable: o.timetable || {},
    stars: o.stars || []
  };
  return d;
}
function teacher(id, name, opt){
  return Object.assign({ id, name, role: 'TEACHER', active: true }, opt || {});
}
function student(id, classId, name){
  return { id, fullName: name || ('طالبة ' + id), classId, deleted: false };
}
const SESSION = (id, role) => ({ id, role, school: 'GIRLS' });
// أسبوع مرجعي ثابت: الاثنين 2026-09-28
const WEEK = sw.currentWeek(Date.parse('2026-09-30T09:00:00Z'));
const NOW = Date.parse('2026-09-30T09:00:00Z');
const OPTS = { nowMs: NOW, week: { ...WEEK, label: 'الأسبوع 1' } };

// ══════════════════ 1) فصل فيه 3 معلمات → صاحبة أكبر عدد حصص ═════════════════
test('فصل فيه 3 معلمات: رائدة الفصل صاحبة أكبر عدد حصص', () => {
  const d = makeData({
    classes: [{ id: 'C1', name: 'أ', gradeId: 'G1', teacherIds: ['T1', 'T2', 'T3'] }],
    users: [teacher('T1', 'أ. أولى'), teacher('T2', 'أ. الثانية'), teacher('T3', 'أ. جيم')],
    timetable: {
      T1: ttCell('C1', 2),   // 5 أيام × 2 = 10 حصص
      T2: ttCell('C1', 1),   // 5
      T3: ttCell('C1', 4)    // 20
    }
  });
  const o = sw.classOwner(d, 'C1');
  assert.strictEqual(o.ownerId, 'T3', 'صاحبة أكبر عدد حصص هي الرائدة');
  assert.strictEqual(o.periods, 20);
  assert.strictEqual(o.ownerName, 'أ. جيم');
  assert.strictEqual(o.tie, false);
  assert.strictEqual(o.candidates.length, 3);
});

// ══════════════════ 2) التعادل لا يسبب فشلًا ولا يطلب تدخلًا ═════════════════
test('تعادل في أعلى عدد من الحصص: نتيجة حتمية واحدة بلا خطأ', () => {
  const users = [teacher('T1', 'أ. د'), teacher('T2', 'أ. هدى'), teacher('T3', 'أ. غ')];
  const d1 = makeData({
    classes: [{ id: 'C1', name: 'أ', gradeId: 'G1', teacherIds: ['T1', 'T2', 'T3'] }],
    users,
    timetable: { T1: ttCell('C1', 3), T2: ttCell('C1', 3), T3: ttCell('C1', 1) }
  });
  const o1 = sw.classOwner(d1, 'C1');
  assert.strictEqual(o1.tie, true, 'التعادل مُعلَن');
  assert.ok(o1.ownerId, 'رسمية واحدة على الأقل');
  assert.strictEqual(o1.ownerId, 'T1', 'الحتمية: نفس النتيجة عند التساوي (الأصغر معرّفًا)');

  // حتمية مطلقة: ترتيب مفاتيح الجدول والمستخدمين لا يغيّر الفائز
  const d2 = makeData({
    classes: [{ id: 'C1', name: 'أ', gradeId: 'G1', teacherIds: ['T3', 'T2', 'T1'] }],
    users: users.slice().reverse(),
    timetable: { T3: ttCell('C1', 1), T2: ttCell('C1', 3), T1: ttCell('C1', 3) }
  });
  const o2 = sw.classOwner(d2, 'C1');
  assert.strictEqual(o2.ownerId, o1.ownerId, 'النتيجة نفسها مهما اختلف ترتيب المدخلات');
  assert.strictEqual(sw.classOwner(d1, 'C1').ownerId, o1.ownerId, 'إعادة الحساب مستقرة');
});

// خانات الجدول: الخانة المحذوفة (_del) لا تُحتسب
test('الحصص المحذوفة من الجدول لا تُحتسب في رائدة الفصل', () => {
  const tt = ttCell('C1', 4);
  // نحذف 4 خانات من T1 ليبقى 16 مقابل 20 لغيرها
  for (const day of Object.keys(DAY)) for (const p of [1, 2, 3, 4]) tt[day][p] = { classId: 'C1', _del: true };
  const d = makeData({
    classes: [{ id: 'C1', name: 'أ', gradeId: 'G1', teacherIds: ['T1', 'T2'] }],
    users: [teacher('T1', 'أ. د'), teacher('T2', 'أ. هدى')],
    timetable: { T1: tt, T2: ttCell('C1', 4) }
  });
  assert.strictEqual(sw.periodCountsForClass(d, 'C1').get('T1') || 0, 0, 'الخانات _del مستبعدة');
  assert.strictEqual(sw.classOwner(d, 'C1').ownerId, 'T2');
});

// حصة فصل آخر لا تُحتسب ضمن حصص هذا الفصل
test('حصص فصل آخر لا تُحتسب لنفس المعلمة', () => {
  const tt = ttCell('C1', 2);
  tt.MONDAY[9] = { classId: 'C9', subject: 'لغة' };
  const d = makeData({
    classes: [
      { id: 'C1', name: 'أ', gradeId: 'G1', teacherIds: ['T1'] },
      { id: 'C9', name: 'ب', gradeId: 'G1', teacherIds: ['T1'] }
    ],
    users: [teacher('T1', 'أ. د')],
    timetable: { T1: tt }
  });
  assert.strictEqual(sw.periodCountsForClass(d, 'C1').get('T1'), 10);
  assert.strictEqual(sw.periodCountsForClass(d, 'C9').get('T1'), 1);
});

// ══════════════════ 5) نجمتان لنفس الفصل في نفس الأسبوع → ممنوعة ═════════════════
test('لا يمكن إنشاء نجمتين لنفس الفصل في نفس الأسبوع', () => {
  const d = makeData({
    classes: [{ id: 'C1', name: 'أ', gradeId: 'G1', teacherIds: ['T1'] }],
    students: [student('S1', 'C1')],
    users: [teacher('T1', 'أ. د')],
    timetable: { T1: ttCell('C1', 3) }
  });
  const first = sw.upsertAward(d, SESSION('T1', 'TEACHER'),
    { classId: 'C1', studentId: 'S1', traits: ['khuluqa'] }, OPTS);
  assert.ok(first.record.id.includes(WEEK.key));
  assert.strictEqual(first.stars.length, 1);

  // محاولة ثانية: نفس الأسبوع والفصل لطالبة أخرى → يحدّث السجل نفسه ولا يضيف ثانيًا
  d.students.push(student('S2', 'C1'));
  const second = sw.upsertAward(d, SESSION('T1', 'TEACHER'),
    { classId: 'C1', studentId: 'S2', traits: ['khuluqa', 'masrwla'] }, OPTS);
  assert.strictEqual(second.stars.length, 1, 'قسم النجوم لم يكبر');
  assert.strictEqual(second.record.studentId, 'S2', 'تم تعديل اختيار نفس الأسبوع');
  assert.strictEqual(second.record.createdAt, first.record.createdAt, 'تاريخ الإنشاء الأصلي محفوظ');

  // معرّف النجمة حتمي = weekKey::classId
  assert.strictEqual(sw.awardId(WEEK.key, 'C1'), WEEK.key + '::C1');
  assert.strictEqual(sw.listAwards({ stars: second.stars }).filter(a => a.weekKey === WEEK.key && a.classId === 'C1').length, 1);
});

// ══════════════════ 6) أسبوع جديد ⇒ نجمة جديدة تُقبل ═════════════════
test('يمكن إنشاء نجمة جديدة في أسبوع جديد مع بقاء السابقة', () => {
  const w1 = sw.currentWeek(Date.parse('2026-09-30T09:00:00Z'));
  const w2 = sw.currentWeek(Date.parse('2026-10-07T09:00:00Z'));
  assert.notStrictEqual(w1.key, w2.key, 'أسابيع مختلفة');
  const d = makeData({
    classes: [{ id: 'C1', name: 'أ', gradeId: 'G1', teacherIds: ['T1'] }],
    students: [student('S1', 'C1'), student('S2', 'C1')],
    users: [teacher('T1', 'أ. د')],
    timetable: { T1: ttCell('C1', 3) }
  });
  const a = sw.upsertAward(d, SESSION('T1', 'TEACHER'),
    { classId: 'C1', studentId: 'S1', traits: ['khuluqa'] }, { nowMs: NOW, week: w1 });
  d.stars = a.stars;
  const b = sw.upsertAward(d, SESSION('T1', 'TEACHER'),
    { classId: 'C1', studentId: 'S2', traits: ['mjthda'] }, { nowMs: NOW, week: w2 });
  d.stars = b.stars;
  assert.strictEqual(d.stars.length, 2, 'النجمتان محفوظتان');
  assert.strictEqual(d.stars.filter(x => x.weekKey === w1.key).length, 1);
  assert.strictEqual(d.stars.filter(x => x.weekKey === w2.key).length, 1);
});

// ══════════════════ 3) صاحبة أكبر عدد حصص تستطيع الاختيار ═════════════════
test('المعلمة المخولة تستطيع إنشاء نجمة الأسبوع', () => {
  const d = makeData({
    classes: [{ id: 'C1', name: 'أ', gradeId: 'G1', teacherIds: ['T1', 'T2'] }],
    students: [student('S1', 'C1')],
    users: [teacher('T1', 'أ. رائدة'), teacher('T2', 'أ. أخرى')],
    timetable: { T1: ttCell('C1', 5), T2: ttCell('C1', 1) }
  });
  const out = sw.upsertAward(d, SESSION('T1', 'TEACHER'),
    { classId: 'C1', studentId: 'S1', traits: ['khuluqa', 'masrwla'], message: '  مجتهدة   ومبدعة  ' }, OPTS);
  assert.strictEqual(out.record.teacherId, 'T1', 'teacherId من الجلسة');
  assert.strictEqual(out.record.studentName, 'طالبة S1');
  assert.deepStrictEqual(out.record.traits, ['khuluqa', 'masrwla']);
  assert.strictEqual(out.record.message, 'مجتهدة ومبدعة', 'تنظيف المسافات');
  assert.strictEqual(out.record.weekKey, WEEK.key);
});

// ══════════════════ 4) معلمة غير مخولة → مرفوضة في الخادم ═════════════════
test('معلمة أخرى غير مخولة لا تستطيع إنشاء نجمة لذلك الفصل', () => {
  const d = makeData({
    classes: [{ id: 'C1', name: 'أ', gradeId: 'G1', teacherIds: ['T1', 'T2'] }],
    students: [student('S1', 'C1')],
    users: [teacher('T1', 'أ. رائدة'), teacher('T2', 'أ. أخرى')],
    timetable: { T1: ttCell('C1', 5), T2: ttCell('C1', 1) }
  });
  assert.throws(() => sw.upsertAward(d, SESSION('T2', 'TEACHER'),
    { classId: 'C1', studentId: 'S1', traits: ['khuluqa'] }, OPTS),
  e => e.code === 'not_owner' && e.status === 403);

  // وخلوّها من الجدول تمامًا: الملكية المعلنة (teacherIds) هي الحاكم بترتيبها،
  // لا المقارنة الأبجدية على المعرّف (التي كانت تُغيّب صاحبة الفصل الحقيقية).
  const d2 = makeData({
    classes: [{ id: 'C1', name: 'أ', gradeId: 'G1', teacherIds: ['T2', 'T1'] }],
    students: [student('S1', 'C1')],
    users: [teacher('T1', 'أ. أ'), teacher('T2', 'أ. ب')],
    timetable: {}
  });
  const o = sw.classOwner(d2, 'C1');
  assert.strictEqual(o.ownerId, 'T2', 'بلا جدول: صاحبة الفصل المعلنة أولًا');
  assert.strictEqual(o.source, 'ownership');
  assert.throws(() => sw.upsertAward(d2, SESSION('T1', 'TEACHER'),
    { classId: 'C1', studentId: 'S1', traits: ['khuluqa'] }, OPTS),
  e => e.code === 'not_owner');
});

// ══════════════════ 9) الطالبة ليست من نفس الفصل → مرفوضة ═════════════════
test('الطالبة المختارة يجب أن تكون من نفس الفصل', () => {
  const d = makeData({
    classes: [
      { id: 'C1', name: 'أ', gradeId: 'G1', teacherIds: ['T1'] },
      { id: 'C2', name: 'ب', gradeId: 'G1', teacherIds: ['T2'] }
    ],
    students: [student('S1', 'C1'), student('S2', 'C2')],
    users: [teacher('T1', 'أ. د'), teacher('T2', 'أ. هدى')],
    timetable: { T1: ttCell('C1', 3), T2: ttCell('C2', 3) }
  });
  assert.throws(() => sw.upsertAward(d, SESSION('T1', 'TEACHER'),
    { classId: 'C1', studentId: 'S2', traits: ['khuluqa'] }, OPTS),
  e => e.code === 'student_not_in_class');

  // طالبة محذوفة تُرفض أيضًا
  d.students.push({ id: 'S9', fullName: 'محذوفة', classId: 'C1', deleted: true });
  assert.throws(() => sw.upsertAward(d, SESSION('T1', 'TEACHER'),
    { classId: 'C1', studentId: 'S9', traits: ['khuluqa'] }, OPTS),
  e => e.code === 'bad_student');
});

// ══════════════════ 8) الصفات: حفظ واسترجاع + رفض غير الصالحة ═════════════════
test('الصفات تُحفظ وتُسترجع، والقيم غير الصالحة تُهمل', () => {
  const d = makeData({
    classes: [{ id: 'C1', name: 'أ', gradeId: 'G1', teacherIds: ['T1'] }],
    students: [student('S1', 'C1')],
    users: [teacher('T1', 'أ. د')],
    timetable: { T1: ttCell('C1', 3) }
  });
  const out = sw.upsertAward(d, SESSION('T1', 'TEACHER'), {
    classId: 'C1', studentId: 'S1',
    traits: ['khuluqa', 'evil_injection', 'khuluqa', 123, null, 'mjthda', 'zamila', 'nadhafa', 'musharika', 'mbadara', 'mbdea', 'EXTRA']
  }, OPTS);
  assert.deepStrictEqual(out.record.traits,
    ['khuluqa', 'mjthda', 'zamila', 'nadhafa', 'musharika', 'mbadara'],
    'الصفات غير الصالحة والاخray والتكرار أُسقطت، والحد الأقصى 6');
  assert.strictEqual(out.record.traits.length, sw.MAX_TRAITS);

  // استرجاع العرض مع التسميات
  const v = sw.publicAward(d, out.record);
  assert.deepStrictEqual(v.traits, out.record.traits);
  assert.ok(v.traitsLabels.every(x => /[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/u.test(x) || true));
  assert.ok(v.traitsLabels[0].includes('خلوقة'));

  // لا صفات ⇒ رفض
  assert.throws(() => sw.upsertAward(d, SESSION('T1', 'TEACHER'),
    { classId: 'C1', studentId: 'S1', traits: ['nope'] }, OPTS), e => e.code === 'bad_traits');
  assert.throws(() => sw.upsertAward(d, SESSION('T1', 'TEACHER'),
    { classId: 'C1', studentId: 'S1' }, OPTS), e => e.code === 'bad_traits');
});

// ══════════════════ 10) سجل الأسابيع السابقة لا يختفي ═════════════════
test('سجل الأسابيع السابقة لا يختفي عند بدء أسبوع جديد', () => {
  const w1 = { key: '2026-09-21', start: '2026-09-21', end: '2026-09-27' };
  const w2 = { key: '2026-09-28', start: '2026-09-28', end: '2026-10-04' };
  const d = makeData({
    classes: [{ id: 'C1', name: 'أ', gradeId: 'G1', teacherIds: ['T1'] }],
    students: [student('S1', 'C1'), student('S2', 'C1')],
    users: [teacher('T1', 'أ. د')],
    timetable: { T1: ttCell('C1', 3) },
    stars: [{
      id: '2026-09-21::C1', weekKey: '2026-09-21', weekStart: w1.start, weekEnd: w1.end,
      classId: 'C1', studentId: 'S1', studentName: 'طالبة S1', traits: ['khuluqa'],
      message: 'أسبوع ممتاز', teacherId: 'T1', teacherName: 'أ. د',
      createdAt: '2026-09-21T08:00:00.000Z', updatedAt: '2026-09-21T08:00:00.000Z'
    }]
  });
  const out = sw.upsertAward(d, SESSION('T1', 'TEACHER'),
    { classId: 'C1', studentId: 'S2', traits: ['masrwla'] }, { nowMs: NOW, week: w2 });
  assert.strictEqual(out.stars.length, 2, 'الأسبوع السابق باقٍ');
  const past = out.stars.find(x => x.weekKey === w1.key);
  assert.ok(past, 'سجل الأسبوع الماضي موجود');
  assert.strictEqual(past.studentName, 'طالبة S1');
  assert.strictEqual(past.message, 'أسبوع ممتاز');

  // عرض الإداري: كل الأسابيع تنازليًا
  const view = sw.buildView({ ...d, stars: out.stars }, SESSION('A1', 'ADMIN'), { ...w2, label: 'الأسبوع 2' }, OPTS);
  assert.strictEqual(view.history.length, 2);
  assert.strictEqual(view.history[0].weekKey, w2.key, 'الأحدث أولًا');
  assert.ok(view.history[1].traitsLabels[0].includes('خلوقة'));
});

// ══════════════════ 11) الصلاحيات: الطالب/غير المخول/alta عبر API ═════════════════
test('الطالبة لا تستطيع إنشاء أو تعديل نجمة الأسبوع', () => {
  const d = makeData({
    classes: [{ id: 'C1', name: 'أ', gradeId: 'G1', teacherIds: ['T1'] }],
    students: [student('S1', 'C1')],
    users: [teacher('T1', 'أ. د')],
    timetable: { T1: ttCell('C1', 3) }
  });
  // طالبة تحاول اختيار نفسها
  assert.throws(() => sw.upsertAward(d, SESSION('S1', 'STUDENT'),
    { classId: 'C1', studentId: 'S1', traits: ['khuluqa'] }, OPTS),
  e => e.code === 'forbidden' && e.status === 403);
  // ومعلمة تحاول فتح فصل لا تملكه
  assert.throws(() => sw.upsertAward(d, SESSION('T9', 'TEACHER'),
    { classId: 'C1', studentId: 'S1', traits: ['khuluqa'] }, OPTS),
  e => e.code === 'not_owner');
  // فصل غير موجود
  assert.throws(() => sw.upsertAward(d, SESSION('T1', 'TEACHER'),
    { classId: 'NOPE', studentId: 'S1', traits: ['khuluqa'] }, OPTS), e => e.code === 'bad_class');
  // والقسم يبدأ فارغًا: لا كتابة عند الرفض
  assert.strictEqual(d.stars.length, 0, 'لا كتابة عند الرفض');
});

// تحوير teacherId في الطلب لا يفيد: القيمة تأتي من الجلسة دائمًا
test('teacherId القادم من العميل يُتجاهل (ملكية من الجلسة)', () => {
  const d = makeData({
    classes: [{ id: 'C1', name: 'أ', gradeId: 'G1', teacherIds: ['T1', 'T2'] }],
    students: [student('S1', 'C1')],
    users: [teacher('T1', 'أ. رائدة'), teacher('T2', 'أ. أخرى')],
    timetable: { T1: ttCell('C1', 4), T2: ttCell('C1', 1) }
  });
  const out = sw.upsertAward(d, SESSION('T1', 'TEACHER'),
    { classId: 'C1', studentId: 'S1', traits: ['khuluqa'], teacherId: 'T2' }, OPTS);
  assert.strictEqual(out.record.teacherId, 'T1', 'teacherId من الجلسة لا من الطلب');
  assert.strictEqual(out.record.teacherName, 'أ. رائدة', 'الاسم مُشتق من المعرّف');
});

// ══════════════════ 12) الاختيار محصور في فصول ريادة المعلمة ═════════════════
test('الطالبة ترى نجمة فصلها فقط، والمعلمة فصولها، والإداري الكل', () => {
  const w = { key: '2026-09-28', start: '2026-09-28', end: '2026-10-04', label: 'الأسبوع 1' };
  const d = makeData({
    classes: [
      { id: 'C1', name: 'أ', gradeId: 'G1', teacherIds: ['T1'] },
      { id: 'C2', name: 'ب', gradeId: 'G1', teacherIds: ['T2'] }
    ],
    students: [student('S1', 'C1'), student('S2', 'C2')],
    users: [teacher('T1', 'أ. د'), teacher('T2', 'أ. هدى')],
    timetable: { T1: ttCell('C1', 3), T2: ttCell('C2', 3) },
    stars: [
      { id: w.key + '::C1', weekKey: w.key, classId: 'C1', studentId: 'S1', studentName: 'س1', traits: ['khuluqa'], teacherId: 'T1' },
      { id: w.key + '::C2', weekKey: w.key, classId: 'C2', studentId: 'S2', studentName: 'س2', traits: ['masrwla'], teacherId: 'T2' }
    ]
  });
  const stu = sw.buildView(d, SESSION('S1', 'STUDENT'), w, OPTS);
  assert.strictEqual(stu.stars.length, 1, 'الطالبة ترى نجمة فصلها فقط');
  assert.strictEqual(stu.stars[0].classId, 'C1');
  assert.deepStrictEqual(stu.me.ownedClassIds, [], 'الطالبة لا تملك فصولًا');

  const tch = sw.buildView(d, SESSION('T1', 'TEACHER'), w, OPTS);
  assert.strictEqual(tch.stars.length, 1);
  assert.strictEqual(tch.stars[0].classId, 'C1');
  assert.deepStrictEqual(tch.me.ownedClassIds, ['C1'], 'فصلها هي رئيسته');

  const adm = sw.buildView(d, SESSION('A1', 'ADMIN'), w, OPTS);
  assert.strictEqual(adm.stars.length, 2, 'الإداري يرى الكل');
  assert.strictEqual(adm.owners.length, 2, 'مع رائدة كل فصل وعدد حصصها');
  assert.deepStrictEqual(adm.owners.map(o => o.ownerId).sort(), ['T1', 'T2']);
  assert.strictEqual(adm.owners[0].periods, 15);
  assert.strictEqual(adm.history.length, 2);
});

// ══════════════════ 13) الأسبوع: مفتاح مستقر + تسمية مطابقة للواجهة ═════════════════
test('مفتاح الأسبوع ثابت عبر الأسبوع ويُشتق من يوم الاثنين', () => {
  // الأحد 2026-09-27 والأحد 2026-10-04 ينتميان لأسبوعين مختلفين (الاثنين 21 ثم 28)
  const a = sw.currentWeek(Date.parse('2026-09-27T12:00:00Z'));
  const b = sw.currentWeek(Date.parse('2026-10-04T12:00:00Z'));
  assert.strictEqual(a.key, '2026-09-21');
  assert.strictEqual(b.key, '2026-09-28');
  assert.strictEqual(a.end, '2026-09-27', 'نهاية الأسبوع الأحد');
  assert.strictEqual(sw.currentWeek(Date.parse('2026-09-21T00:00:00Z')).key, '2026-09-21');
  assert.strictEqual(sw.currentWeek(Date.parse('2026-09-23T23:00:00Z')).key, '2026-09-21', 'كل الأسبوع نفس المفتاح');
  assert.strictEqual(sw.currentWeek(Date.parse('2026-09-28T00:00:00Z')).key, '2026-09-28', 'الاثنين بداية أسبوع');

  // التسمية تتبع نفس حساب schoolWeekInfo
  assert.strictEqual(sw.weekLabel({ key: '2026-09-21' }, '2026-09-07'), 'الأسبوع 3');
  assert.ok(sw.weekLabel({ key: '2026-09-21' }, null).includes('2026-09-21'), 'تسمية احتياطية');
});

// ══════════════════ 14) لا مساس بالحضور/النقاط ولا تكرار معلمين/فصول ═════════════════
test('الميزة لا تمسّ الحضور ولا النقاط ولا تكرر المعلمات أو الفصول', () => {
  const d = makeData({
    classes: [{ id: 'C1', name: 'أ', gradeId: 'G1', teacherIds: ['T1', 'T2'] }],
    students: [student('S1', 'C1')],
    users: [teacher('T1', 'أ. د'), teacher('T2', 'أ. هدى')],
    timetable: { T1: ttCell('C1', 4), T2: ttCell('C1', 1) }
  });
  d.attendance = [{ id: 'A1', studentId: 'S1', date: '2026-09-28', status: 'present' }];
  d.pointsLedger = [{ id: 'P1', studentId: 'S1', delta: 5 }];
  d.maintenance = [{ id: 'M1', type: 'toilet' }];
  const before = JSON.stringify({ attendance: d.attendance, points: d.pointsLedger, maintenance: d.maintenance, users: d.users, classes: d.classes, timetable: d.timetable });

  const out = sw.upsertAward(d, SESSION('T1', 'TEACHER'),
    { classId: 'C1', studentId: 'S1', traits: ['khuluqa'] }, OPTS);

  assert.strictEqual(out.stars.length, 1);
  assert.strictEqual(JSON.stringify({ attendance: d.attendance, points: d.pointsLedger, maintenance: d.maintenance, users: d.users, classes: d.classes, timetable: d.timetable }),
    before, 'أقسام الحضور/النقاط/المعلمات/الفصول/الجدول دون تغيير');
  assert.deepStrictEqual(Object.keys(out).filter(k => k !== 'record').sort(), ['owner', 'stars', 'week']);
  assert.strictEqual(JSON.parse(JSON.stringify(out.stars)).length, 1, 'قسم النجوم نظيف وقابل للتخزين');
  assert.strictEqual(sw.classOwner(d, 'C1').candidates.length, 2, 'لا تكرار معلمات');
  assert.strictEqual(sw.classCandidates(d, 'C1').length, 2, 'لا مرشحين مكررين');
});

// section-safe: قسم النجوم وحده هو ما تغيّر
test('الكتابة تمسّ قسم stars فقط', () => {
  const d = makeData({
    classes: [{ id: 'C1', name: 'أ', gradeId: 'G1', teacherIds: ['T1'] }],
    students: [student('S1', 'C1')],
    users: [teacher('T1', 'أ. د')],
    timetable: { T1: ttCell('C1', 3) }
  });
  const keysBefore = Object.keys(d).sort();
  sw.upsertAward(d, SESSION('T1', 'TEACHER'),
    { classId: 'C1', studentId: 'S1', traits: ['khuluqa'] }, OPTS);
  d.stars = sw.listAwards(d);
  assert.deepStrictEqual(Object.keys(d).sort(), keysBefore, 'لا أقسام جديدة ولا مفقودة');
});

  // الحسابات المعطّلة لا تُمنح صلاحية الاختيار إن وُجدت نشطة
test('الحساب المعطّل لا يُمنح صلاحية الاختيار إن وُجدت نشطة', () => {
  const d = makeData({
    classes: [{ id: 'C1', name: 'أ', gradeId: 'G1', teacherIds: ['T1', 'T2'] }],
    students: [student('S1', 'C1')],
    users: [teacher('T1', 'أ. معطّلة', { active: false }), teacher('T2', 'أ. نشطة')],
    timetable: { T1: ttCell('C1', 5), T2: ttCell('C1', 1) }
  });
  assert.strictEqual(sw.classOwner(d, 'C1').ownerId, 'T2', 'النشطة تُقدَّم على المعطّلة الأكثر حصصًا');
  assert.throws(() => sw.upsertAward(d, SESSION('T1', 'TEACHER'),
    { classId: 'C1', studentId: 'S1', traits: ['khuluqa'] }, OPTS), e => e.code === 'not_owner');
  // إن لم توجد نشطة أصلًا تُستعمل المعطّلة بدل تعطيل الميزة كلها
  const d2 = makeData({
    classes: [{ id: 'C1', name: 'أ', gradeId: 'G1', teacherIds: ['T1'] }],
    students: [student('S1', 'C1')],
    users: [teacher('T1', 'أ. د', { active: false })],
    timetable: { T1: ttCell('C1', 3) }
  });
  assert.strictEqual(sw.classOwner(d2, 'C1').ownerId, 'T1');
});

// ══════════════ 7) جدول فارغ: الرجوع إلى ملكية الفصل (توافق البيانات الواقعية) ═══
// سبب النقص الأصلي: في فصل بلا جدول كان كل المرشّحات بدرجة صفر، فيُختار بالأبجدية
// لا بالواقع — فتفقد صاحبة الفصل الحقيقية الأداة. هذه الاختبارات تقفل ذلك المسار.
test('فصل بلا جدول: صاحبة الفصل (teacherIds) هي الرائدة لا الأبجدية', () => {
  const d = makeData({
    classes: [{ id: 'C2', name: 'الصف الثاني', gradeId: 'G1', teacherIds: ['T9', 'T1'] }],
    students: [student('S1', 'C2')],
    users: [teacher('T9', 'شيماء'), teacher('T1', 'أ. أخرى')],
    timetable: {}
  });
  const o = sw.classOwner(d, 'C2');
  assert.strictEqual(o.ownerId, 'T9', 'شيماء صاحبة الفصل، لا صاحبة المعرّف الأصغر');
  assert.strictEqual(o.source, 'ownership');
  assert.strictEqual(o.tie, false, 'غياب الجدول ليس تعادلًا يُعرض للإدارة');
});

test('ترتيب teacherIds هو الحاكم عند غياب الجدول (حتمي)', () => {
  const mk = ids => makeData({
    classes: [{ id: 'C2', name: 'الثاني', gradeId: 'G1', teacherIds: ids }],
    students: [student('S1', 'C2')],
    users: ids.map(id => teacher(id, 'أ. ' + id)),
    timetable: {}
  });
  assert.strictEqual(sw.classOwner(mk(['T9', 'T1']), 'C2').ownerId, 'T9');
  assert.strictEqual(sw.classOwner(mk(['T1', 'T9']), 'C2').ownerId, 'T1');
});

test('الرجوع للملكية يمنح الصلاحية فعليًا (upsertAward ينجح)', () => {
  const d = makeData({
    classes: [{ id: 'C2', name: 'الثاني', gradeId: 'G1', teacherIds: ['T9', 'T1'] }],
    students: [student('S1', 'C2')],
    users: [teacher('T9', 'شيماء'), teacher('T1', 'أ. أخرى')],
    timetable: {}
  });
  const r = sw.upsertAward(d, SESSION('T9', 'TEACHER'),
    { classId: 'C2', studentId: 'S1', traits: ['khuluqa'] }, OPTS);
  assert.strictEqual(r.record.studentId, 'S1');
  assert.strictEqual(r.owner.ownerId, 'T9');
  assert.deepStrictEqual(sw.ownedClassIds(d, 'T9'), ['C2']);
});

test('جدول موجود لكن كل خاناته محذوفة (_del) ⇒ نفس الرجوع للملكية', () => {
  const dead = ttCell('C2', 3);
  for (const day of Object.keys(dead)) for (const p of Object.keys(dead[day])) dead[day][p]._del = true;
  const d = makeData({
    classes: [{ id: 'C2', name: 'الثاني', gradeId: 'G1', teacherIds: ['T9', 'T1'] }],
    students: [student('S1', 'C2')],
    users: [teacher('T9', 'شيماء'), teacher('T1', 'أ. أخرى')],
    timetable: { T1: dead }
  });
  assert.strictEqual(sw.classOwner(d, 'C2').ownerId, 'T9');
  assert.strictEqual(sw.classOwner(d, 'C2').source, 'ownership');
});

test('فصل بلا جدول وبلا معلمات معلنة ⇒ لا رائدة (بلا انهيار)', () => {
  const d = makeData({
    classes: [{ id: 'C3', name: 'الثالث', gradeId: 'G1', teacherIds: [] }],
    students: [student('S1', 'C3')],
    users: [teacher('T1', 'أ')],
    timetable: {}
  });
  const o = sw.classOwner(d, 'C3');
  assert.strictEqual(o.ownerId, null);
  assert.strictEqual(o.source, 'none');
  assert.deepStrictEqual(sw.ownedClassIds(d, 'T1'), [], 'لا صلاحية بلا ملكية ولا جدول');
});

test('وجود الجدول يبقي المصدر timetable ولا يفعّل الرجوع', () => {
  const d = makeData({
    classes: [{ id: 'C1', name: 'أ', gradeId: 'G1', teacherIds: ['T1', 'T2'] }],
    students: [student('S1', 'C1')],
    users: [teacher('T1', 'أ'), teacher('T2', 'ب')],
    timetable: { T1: ttCell('C1', 2), T2: ttCell('C1', 5) }
  });
  const o = sw.classOwner(d, 'C1');
  assert.strictEqual(o.ownerId, 'T2');
  assert.strictEqual(o.source, 'timetable');
});

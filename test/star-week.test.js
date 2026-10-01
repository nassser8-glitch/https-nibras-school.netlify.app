'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const sw = require('../star-week.js');

const WEEK = { key: '2026-09-28', start: '2026-09-28', end: '2026-10-04', label: 'الأسبوع 1' };
const ADMIN = { user_id: 'A1', role: 'ADMIN', school: 'GIRLS' };
const data = () => ({
  grades: [{ id: 'G1', name: 'الصف الأول' }],
  classes: [{ id: 'C1', name: 'أ', gradeId: 'G1' }, { id: 'C2', name: 'ب', gradeId: 'G1' }],
  students: [
    { id: 'S1', fullName: 'نورة', classId: 'C1' },
    { id: 'S2', fullName: 'سارة', classId: 'C2' }
  ],
  users: [{ id: 'A1', name: 'المديرة', role: 'ADMIN' }],
  stars: [{
    id: '2026-09-21', weekKey: '2026-09-21', classId: 'C1', studentId: 'S1',
    studentName: 'نورة', traits: ['mjthda'], message: 'سابقًا'
  }]
});

test('ADMIN session user_id can create a server-validated star by ID', () => {
  const out = sw.upsertAward(data(), ADMIN, {
    classId: 'C1', studentId: 'S1', traits: ['mjthda'], message: '  أحسنتِ  '
  }, { week: WEEK, nowMs: Date.parse('2026-10-01T00:00:00Z') });
  assert.equal(out.record.id, WEEK.key);
  assert.equal(out.record.teacherId, 'A1');
  assert.equal(out.record.classId, 'C1');
  assert.equal(out.record.studentId, 'S1');
  assert.equal(out.record.message, 'أحسنتِ');
});

test('TEACHER, STUDENT, and other staff cannot mutate even with a valid student/class', () => {
  for (const role of ['TEACHER', 'STUDENT', 'ADMINISTRATIVE', 'AGENT', 'COUNSELOR', 'SCHOOL_AGENT']) {
    assert.throws(() => sw.upsertAward(data(), { user_id: 'U1', role, school: 'GIRLS' }, {
      classId: 'C1', studentId: 'S1', traits: ['mjthda']
    }, { week: WEEK }), error => error.status === 403 && error.code === 'forbidden', role);
  }
});

test('a missing session is an authentication error, not an authorization error', () => {
  assert.throws(() => sw.upsertAward(data(), null, {}, { week: WEEK }),
    error => error.status === 401 && error.code === 'unauthenticated');
});

test('a student must exist, the class must exist, and the IDs must belong together', () => {
  assert.throws(() => sw.upsertAward(data(), ADMIN, {
    classId: 'C3', studentId: 'S1', traits: ['mjthda']
  }, { week: WEEK }), error => error.code === 'bad_class');
  assert.throws(() => sw.upsertAward(data(), ADMIN, {
    classId: 'C1', studentId: 'S2', traits: ['mjthda']
  }, { week: WEEK }), error => error.code === 'student_not_in_class');
  assert.throws(() => sw.upsertAward(data(), ADMIN, {
    classId: 'C1', studentId: 'missing', traits: ['mjthda']
  }, { week: WEEK }), error => error.code === 'bad_student');
});

test('one school-wide award is updated within the week and prior weeks are retained', () => {
  const initial = data();
  const first = sw.upsertAward(initial, ADMIN, {
    classId: 'C1', studentId: 'S1', traits: ['mjthda']
  }, { week: WEEK, nowMs: Date.parse('2026-10-01T00:00:00Z') });
  const updated = sw.upsertAward({ ...initial, stars: first.stars }, ADMIN, {
    classId: 'C2', studentId: 'S2', traits: ['khuluqa']
  }, { week: WEEK, nowMs: Date.parse('2026-10-02T00:00:00Z') });
  assert.equal(updated.stars.length, 2);
  assert.equal(updated.stars.filter(star => star.weekKey === WEEK.key).length, 1);
  assert.equal(updated.record.studentId, 'S2');
  assert.equal(updated.record.classId, 'C2');
  assert.ok(updated.stars.some(star => star.weekKey === '2026-09-21'));
  assert.equal(sw.awardId(WEEK.key), WEEK.key);
});

test('all authenticated roles see the same current school award; only ADMIN gets management data', () => {
  const current = sw.upsertAward(data(), ADMIN, {
    classId: 'C1', studentId: 'S1', traits: ['mjthda'], message: 'من الخادم'
  }, { week: WEEK }).record;
  const schoolData = { ...data(), stars: [current] };
  for (const role of ['ADMIN', 'TEACHER', 'STUDENT', 'ADMINISTRATIVE', 'AGENT', 'COUNSELOR', 'SCHOOL_AGENT']) {
    const view = sw.buildView(schoolData, { user_id: 'U1', role, school: 'GIRLS' }, WEEK);
    assert.equal(view.stars.length, 1, role);
    assert.equal(view.stars[0].studentName, 'نورة', role);
    assert.equal(view.stars[0].className, 'الصف الأول — أ', role);
    assert.equal(view.me.isManager, role === 'ADMIN', role);
    assert.equal(view.classes.length > 0, role === 'ADMIN', role);
  }
});

test('allowed trait labels and optional manager message are sanitized', () => {
  const out = sw.upsertAward(data(), ADMIN, {
    classId: 'C1', studentId: 'S1', traits: ['mjthda', '<script>', 'mjthda'],
    message: '  كلمة  <script>  '
  }, { week: WEEK });
  assert.deepEqual(out.record.traits, ['mjthda']);
  assert.equal(out.record.message, 'كلمة <script>');
  const view = sw.publicAward(data(), out.record);
  assert.deepEqual(view.traitsLabels, ['🌟 مجتهدة']);
});

test('week keys are stable Monday-based school weeks', () => {
  assert.deepEqual(sw.currentWeek(Date.parse('2026-09-30T09:00:00Z')), {
    key: '2026-09-28', start: '2026-09-28', end: '2026-10-04'
  });
});

test('class timetable calculations remain deterministic for the existing class summary', () => {
  const schoolData = data();
  schoolData.classes[0].teacherIds = ['T1', 'T2'];
  schoolData.users.push(
    { id: 'T1', name: 'معلمة 1', role: 'TEACHER', active: true },
    { id: 'T2', name: 'معلمة 2', role: 'TEACHER', active: true }
  );
  schoolData.timetable = {
    T1: { MONDAY: { 1: { classId: 'C1' }, 2: { classId: 'C1', _del: true } } },
    T2: { MONDAY: { 1: { classId: 'C1' }, 2: { classId: 'C1' }, 3: { classId: 'C2' } } }
  };
  assert.equal(sw.periodCountsForClass(schoolData, 'C1').get('T1'), 1);
  assert.equal(sw.classOwner(schoolData, 'C1').ownerId, 'T2');
});

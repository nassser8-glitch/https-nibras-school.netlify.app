'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start !== -1, `الدالة ${name} غير موجودة`);
  const rest = src.slice(start);
  const m = rest.match(/\r?\n\}(?=\r?\n(?:function |async function |let |const |\/\*|<\/script>|\r?\n))/);
  assert.ok(m, `تعذر استخراج الدالة ${name}`);
  return rest.slice(0, m.index + m[0].length);
}

test('1) إحصائيات الحضور للمعلمة: عدم تكرار اليوم، جمع الدقائق الفعلية، احترام الفترة الدراسية، وصفر عند غياب السجلات', () => {
  const code = [
    'function escapeHtml(s){ return String(s==null?"":s); }',
    extractFn(HTML, 'computePersonAttendanceStats'),
    extractFn(HTML, 'renderAttendanceStatsCards'),
  ].join('\n');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(code, ctx);

  const now = new Date('2026-11-20T10:00:00Z');
  const teacher = {
    id: 't1',
    role: 'TEACHER',
    absences: ['2026-10-05', '2026-10-05', '2026-11-02', '2026-05-10'],
    markedLate: ['2026-10-12', '2026-10-12', '2026-10-19'],
    lateMinutes: { '2026-10-12': 17, '2026-11-10': 8, '2026-04-01': 30 },
  };
  const st = ctx.computePersonAttendanceStats(teacher, {}, { now });
  assert.equal(st.absentDays, 2, 'يجب احتساب أيام الغياب الفريدة فقط ضمن السنة الدراسية');
  assert.equal(st.lateDays, 3, 'يجب احتساب أيام التأخير الفريدة (اتحاد markedLate و lateMinutes)');
  assert.equal(st.lateMinutes, 25, 'يجب جمع دقائق التأخير الفعلية بدقة (17 + 8 = 25)');

  const empty = ctx.computePersonAttendanceStats({ id: 't2', role: 'TEACHER' }, {}, { now });
  assert.deepEqual({ a: empty.absentDays, l: empty.lateDays, m: empty.lateMinutes }, { a: 0, l: 0, m: 0 });

  const cardHtml = ctx.renderAttendanceStatsCards(st, { teacherId: 't1' });
  assert.ok(cardHtml.includes('🔴 أيام الغياب') && cardHtml.includes('>2<'), 'بطاقة أيام الغياب غير صحيحة');
  assert.ok(cardHtml.includes('🟠 أيام التأخير') && cardHtml.includes('>3<'), 'بطاقة أيام التأخير غير صحيحة');
  assert.ok(cardHtml.includes('⏱️ مجموع دقائق التأخير') && cardHtml.includes('25'), 'بطاقة دقائق التأخير غير صحيحة');
});

test('2) إحصائيات الحضور للطالبة: من سجلات الحضور اليومية ودقائق التأخير دون تكرار أو تقدير', () => {
  const code = [
    'function escapeHtml(s){ return String(s==null?"":s); }',
    extractFn(HTML, 'computePersonAttendanceStats'),
    extractFn(HTML, 'renderAttendanceStatsCards'),
  ].join('\n');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(code, ctx);

  const now = new Date('2026-11-20T10:00:00Z');
  const db = {
    students: [
      { id: 's1', fullName: 'طالبة تجريبية', lateMinutes: { '2026-10-14': 12, '2026-11-04': 7 } },
      { id: 's2', fullName: 'طالبة بلا سجلات' },
    ],
    attendance: [
      { studentId: 's1', date: '2026-10-01', status: 'ABSENT' },
      { studentId: 's1', date: '2026-10-01', status: 'ABSENT' },
      { studentId: 's1', date: '2026-10-20', status: 'ABSENT' },
      { studentId: 's1', date: '2026-03-10', status: 'ABSENT' },
      { studentId: 's1', date: '2026-10-14', status: 'LATE', lateMinutes: 12 },
      { studentId: 's1', date: '2026-10-28', status: 'LATE', lateMinutes: 5 },
      { studentId: 's1', date: '2026-11-01', status: 'PRESENT' },
    ],
  };

  const st = ctx.computePersonAttendanceStats({ id: 's1', role: 'STUDENT' }, db, { now });
  assert.equal(st.absentDays, 2, 'أيام غياب الطالبة الفريدة يجب أن تساوي 2');
  assert.equal(st.lateDays, 3, 'أيام تأخير الطالبة الفريدة يجب أن تساوي 3');
  assert.equal(st.lateMinutes, 24, 'مجموع دقائق التأخير الفعلية يجب أن يساوي 24 (12 + 5 + 7)');

  const empty = ctx.computePersonAttendanceStats({ id: 's2', role: 'STUDENT' }, db, { now });
  assert.deepEqual({ a: empty.absentDays, l: empty.lateDays, m: empty.lateMinutes }, { a: 0, l: 0, m: 0 });
});

test('3) ربط البطاقات الثلاث في نوافذ تفاصيل العين (openRoleInbox و renderTeacherView و showStudentPoints)', () => {
  const inboxFn = extractFn(HTML, 'openRoleInbox');
  const stuFn = extractFn(HTML, 'showStudentPoints');
  assert.ok(inboxFn.includes('renderAttendanceStatsCards(computePersonAttendanceStats('), 'openRoleInbox لا تعرض بطاقات إحصائيات الحضور');
  assert.ok(stuFn.includes('renderAttendanceStatsCards(computePersonAttendanceStats('), 'showStudentPoints لا تعرض بطاقات إحصائيات الحضور');
  assert.ok(HTML.includes('renderAttendanceStatsCards({ absentDays: st.absent, lateDays: st.lateDays, lateMinutes: st.lateMin }, { teacherId })'), 'renderTeacherView لا تعرض البطاقات الثلاث');
});

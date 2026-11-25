'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

function extractRange(startMarker, endMarker) {
  const i = HTML.indexOf(startMarker);
  assert.ok(i !== -1, 'missing startMarker: ' + startMarker);
  const j = HTML.indexOf(endMarker, i);
  assert.ok(j !== -1, 'missing endMarker: ' + endMarker);
  return HTML.slice(i, j);
}

function loadRankingEngine() {
  const attHelpers = extractRange('function __attEffStatus(rec){', '\n/* إحصائية حضور الموعد الفريدة:');
  const rankCode = extractRange('/* ============ ترتيب الطالبات حسب الغياب (منذ بداية العام الدراسي) ============ */', '\n/* ============ الرسوم البيانية ============ */');

  const sandbox = {
    todayStr: () => '2027-01-15',
    escapeHtml: (s) => String(s == null ? '' : s),
    __attIsAbsent: (rec) => !!(rec && rec.status === 'ABSENT'),
    __attOverridable: () => false,
    __cleanClerkId: (c) => (c != null ? String(c).trim() : ''),
    Map, Set, Array, Date, Math, Number, String, Object, JSON
  };
  vm.createContext(sandbox);
  vm.runInContext(attHelpers + '\n' + rankCode, sandbox);
  return sandbox;
}

function makeSampleDB() {
  return {
    grades: [
      { id: 'g1', name: 'الأول متوسط', order: 6 },
      { id: 'g2', name: 'الثاني متوسط', order: 7 }
    ],
    classes: [
      { id: 'c1', name: 'أ', gradeId: 'g1' },
      { id: 'c2', name: 'ب', gradeId: 'g2' }
    ],
    students: [
      { id: 's1', fullName: 'سارة أحمد', classId: 'c1', active: true },
      { id: 's2', fullName: 'نورة خالد', classId: 'c1', active: true },
      { id: 's3', fullName: 'مريم علي', classId: 'c2', active: true },
      { id: 's4', fullName: 'هند سعد', classId: 'c2', active: true }, // 0 غياب
      { id: 's5', fullName: 'طالبة غير نشطة', classId: 'c1', active: false }
    ],
    attendance: [
      // عام سابق — لا يدخل في العام الدراسي 2026/2027
      { id: 'a0', studentId: 's2', classId: 'c1', date: '2026-05-10', status: 'ABSENT' },
      // مريم: 3 أيام (سبتمبر + أكتوبر + يناير)
      { id: 'a1', studentId: 's3', classId: 'c2', date: '2026-09-05', status: 'ABSENT' },
      { id: 'a2', studentId: 's3', classId: 'c2', date: '2026-10-12', status: 'ABSENT' },
      { id: 'a3', studentId: 's3', classId: 'c2', date: '2027-01-10', status: 'ABSENT' },
      // سارة: يوم واحد فقط (مكرر مرتين في نفس اليوم -> يُحسب 1)
      { id: 'a4', studentId: 's1', classId: 'c1', date: '2026-11-02', status: 'ABSENT' },
      { id: 'a5', studentId: 's1', classId: 'c1', date: '2026-11-02', status: 'ABSENT' },
      // نورة: يومان غياب + 2 تأخر بالدقائق (التأخر لا يُحتسب غياباً) + 1 محذوف
      { id: 'a6', studentId: 's2', classId: 'c1', date: '2026-09-20', status: 'ABSENT' },
      { id: 'a7', studentId: 's2', classId: 'c1', date: '2026-10-01', status: 'ABSENT' },
      { id: 'a8', studentId: 's2', classId: 'c1', date: '2026-10-05', status: 'LATE', lateMinutes: 25 },
      { id: 'a9', studentId: 's2', classId: 'c1', date: '2026-10-06', status: 'LATE', lateMinutes: 15 },
      { id: 'a10', studentId: 's2', classId: 'c1', date: '2026-10-08', status: 'ABSENT', deleted: true },
      // هند: تأخر فقط (0 غياب)
      { id: 'a11', studentId: 's4', classId: 'c2', date: '2026-11-10', status: 'LATE', lateMinutes: 10 },
      // طالبة غير نشطة
      { id: 'a12', studentId: 's5', classId: 'c1', date: '2026-11-11', status: 'ABSENT' }
    ]
  };
}

test('1) ترتيب الطالبات تنازلياً بحسب عدد أيام الغياب منذ بداية العام الدراسي', () => {
  const E = loadRankingEngine();
  const db = makeSampleDB();
  const beforeLen = db.attendance.length;
  const res = E.computeStudentAbsenceRanking(db, { refDate: '2027-01-15' });

  assert.equal(res.startDate, '2026-09-01');
  assert.equal(res.rows.length, 3); // هند (0 غياب) مستبعدة افتراضياً، والطالبة غير النشطة مستبعدة
  assert.equal(res.rows[0].rank, 1);
  assert.equal(res.rows[0].name, 'مريم علي');
  assert.equal(res.rows[0].gradeName, 'الثاني متوسط');
  assert.equal(res.rows[0].absenceDays, 3);

  assert.equal(res.rows[1].rank, 2);
  assert.equal(res.rows[1].name, 'نورة خالد');
  assert.equal(res.rows[1].absenceDays, 2);

  assert.equal(res.rows[2].rank, 3);
  assert.equal(res.rows[2].name, 'سارة أحمد');
  assert.equal(res.rows[2].absenceDays, 1);

  // لا تعديل ولا حذف للسجلات الأصلية
  assert.equal(db.attendance.length, beforeLen);
});

test('2) إظهار الطالبات بدون غياب عند تفعيل الخيار includeZero', () => {
  const E = loadRankingEngine();
  const db = makeSampleDB();
  const res = E.computeStudentAbsenceRanking(db, { refDate: '2027-01-15', includeZero: true });
  assert.equal(res.rows.length, 4);
  assert.equal(res.rows[3].rank, 4);
  assert.equal(res.rows[3].name, 'هند سعد');
  assert.equal(res.rows[3].absenceDays, 0);
});

test('3) الجدول يحتوي العنوان والأعمدة الأربعة المطلوبة وإمكانية الضغط على اسم الطالبة', () => {
  const E = loadRankingEngine();
  const db = makeSampleDB();
  const html = E.renderAbsenceRankingTable(db);

  assert.ok(html.includes('ترتيب الطالبات حسب الغياب'));
  assert.ok(html.includes('<th>الترتيب</th><th>اسم الطالبة</th><th>الصف</th><th>عدد أيام الغياب</th>'));
  assert.ok(html.includes('__showStudentAbsenceDatesModal'));
  assert.ok(html.includes('إظهار الطالبات بدون غياب'));
});

test('4) إزالة التعديل السابق بالكامل والمحافظة على بنية الواجهة الحالية', () => {
  assert.equal(HTML.includes('renderCumulativeAbsenceReport'), false);
  assert.equal(HTML.includes('buildAcademicYearAbsenceChart'), false);
  assert.equal(HTML.includes('academicYearSummaryBox'), false);
  assert.equal(HTML.includes('id="absenceRankingBox"'), false);
  assert.ok(HTML.includes('id="reportsAbsenceRankingBox"'));
});

test('5) خيار إظهار بدون غياب متاح ويعمل داخل التقارير فقط', () => {
  const E = loadRankingEngine();
  const db = makeSampleDB();
  const repHtml = E.renderAbsenceRankingTable(db, { isReport: true });

  assert.equal(HTML.includes('__toggleAbsRankZero'), false);
  assert.ok(repHtml.includes('__toggleReportsAbsRankZero(this.checked)'));
  assert.equal(repHtml.includes('هند سعد'), false);

  E.loadDB = () => db;
  E.currentUser = () => ({ role: 'ADMIN' });
  E.seesAllClasses = () => true;
  E.document = { getElementById: () => null };
  E.__toggleReportsAbsRankZero(true);
  assert.equal(E.renderAbsenceRankingTable(db, { isReport: true }).includes('هند سعد'), true);
});

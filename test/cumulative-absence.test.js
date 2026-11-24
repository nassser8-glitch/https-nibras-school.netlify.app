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

function loadAbsenceEngine() {
  const attHelpers = extractRange('function __attEffStatus(rec){', '\n/* إحصائية حضور الموعد الفريدة:');
  const cumEngine = extractRange('/* ============ إحصائية الغياب التراكمية للعام الدراسي ============ */', '\n/* ============ الرسوم البيانية ============ */');

  const sandbox = {
    todayStr: () => '2027-01-15',
    escapeHtml: (s) => String(s == null ? '' : s),
    __attIsAbsent: (rec) => !!(rec && rec.status === 'ABSENT'),
    __attOverridable: () => false,
    __cleanClerkId: (c) => (c != null ? String(c).trim() : ''),
    Map, Set, Array, Date, Math, Number, String, Object, JSON
  };
  vm.createContext(sandbox);
  vm.runInContext(attHelpers + '\n' + cumEngine, sandbox);
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
      { id: 's1', fullName: 'سارة أحمد', studentNo: '101', classId: 'c1', active: true },
      { id: 's2', fullName: 'نورة خالد', studentNo: '102', classId: 'c1', active: true },
      { id: 's3', fullName: 'مريم علي', studentNo: '201', classId: 'c2', active: true },
      { id: 's4', fullName: 'طالبة محذوفة', studentNo: '999', classId: 'c1', active: false }
    ],
    attendance: [
      // عام دراسي سابق (2025/2026) — يجب ألا يدخل في 2026/2027
      { id: 'a0', studentId: 's1', classId: 'c1', date: '2026-05-10', status: 'ABSENT' },
      // سبتمبر 2026 (بداية العام الدراسي 2026/2027)
      { id: 'a1', studentId: 's1', classId: 'c1', date: '2026-09-05', status: 'ABSENT' },
      { id: 'a2', studentId: 's1', classId: 'c1', date: '2026-09-05', status: 'ABSENT' }, // تكرار في نفس اليوم -> يُحسب مرة واحدة
      { id: 'a3', studentId: 's2', classId: 'c1', date: '2026-09-12', status: 'ABSENT', absenceType: 'EXCUSED' },
      // أكتوبر 2026
      { id: 'a4', studentId: 's1', classId: 'c1', date: '2026-10-03', status: 'ABSENT' },
      { id: 'a5', studentId: 's3', classId: 'c2', date: '2026-10-15', status: 'ABSENT' },
      { id: 'a6', studentId: 's2', classId: 'c1', date: '2026-10-20', status: 'LATE' }, // متأخر لا يُحسب غائباً
      { id: 'a7', studentId: 's3', classId: 'c2', date: '2026-10-22', status: 'ABSENT', deleted: true }, // محذوف (قبر)
      // نوفمبر 2026
      { id: 'a8', studentId: 's1', classId: 'c1', date: '2026-11-11', status: 'ABSENT' },
      // يناير 2027 (نفس العام الدراسي 2026/2027 رغم تغير السنة الميلادية!)
      { id: 'a9', studentId: 's3', classId: 'c2', date: '2027-01-10', status: 'ABSENT' },
      // سجل لطالبة غير نشطة
      { id: 'a10', studentId: 's4', classId: 'c1', date: '2026-11-01', status: 'ABSENT' }
    ]
  };
}

test('1) اعتماد العام الدراسي كمرجع (سبتمبر..أغسطس) وليس السنة الميلادية', () => {
  const E = loadAbsenceEngine();
  const ayNov = E.academicYearInfo('2026-11-24');
  assert.equal(ayNov.startYear, 2026);
  assert.equal(ayNov.endYear, 2027);
  assert.equal(ayNov.start, '2026-09-01');
  assert.equal(ayNov.end, '2027-08-31');
  assert.equal(ayNov.label, '2026 / 2027');

  const ayJan = E.academicYearInfo('2027-01-15');
  assert.equal(ayJan.startYear, 2026);
  assert.equal(ayJan.label, '2026 / 2027');

  const ayAug = E.academicYearInfo('2026-08-31');
  assert.equal(ayAug.startYear, 2025);
  assert.equal(ayAug.label, '2025 / 2026');
});

test('2) احتساب جميع حالات الغياب تراكمياً منذ بداية العام دون تصفير عند انتقال الشهر أو السنة الميلادية', () => {
  const E = loadAbsenceEngine();
  const db = makeSampleDB();
  const beforeLen = db.attendance.length;

  const stats = E.computeCumulativeAbsenceStats(db, { refDate: '2027-01-15' });
  // سارة: 2026-09-05 (1)، 2026-10-03 (1)، 2026-11-11 (1) = 3
  // نورة: 2026-09-12 (1) = 1
  // مريم: 2026-10-15 (1)، 2027-01-10 (1) = 2
  // المجموع التراكمي = 6
  assert.equal(stats.annualTotalAbsences, 6);
  assert.equal(stats.annualAbsentStudentsCount, 3);
  assert.equal(stats.currentMonthAbsences, 1); // يناير 2027 فيه حالة واحدة
  // لم تُحذف أو تُعدّل أي سجلات
  assert.equal(db.attendance.length, beforeLen);
});

test('3) الاطلاع على تفاصيل الشهر مع الاحتفاظ بالإجمالي السنوي التراكمي', () => {
  const E = loadAbsenceEngine();
  const db = makeSampleDB();

  const statsOct = E.computeCumulativeAbsenceStats(db, { refDate: '2027-01-15', monthKey: '2026-10' });
  // الإجمالي السنوي التراكمي يبقى 6 ولا يتصفّر
  assert.equal(statsOct.annualTotalAbsences, 6);
  assert.equal(statsOct.selectedMonthKey, '2026-10');
  assert.equal(statsOct.selectedMonthAbsences, 2); // سارة + مريم في أكتوبر
  assert.equal(statsOct.selectedMonthPct, 33);
  assert.equal(statsOct.dailyRecords.length, 2);
});

test('4) التجميع والفلترة حسب الطالبة والصف والفصل', () => {
  const E = loadAbsenceEngine();
  const db = makeSampleDB();

  const allStats = E.computeCumulativeAbsenceStats(db, { refDate: '2027-01-15' });
  assert.equal(allStats.byGrade.length, 2);
  assert.equal(allStats.byGrade[0].gradeId, 'g1');
  assert.equal(allStats.byGrade[0].annualTotal, 4); // سارة 3 + نورة 1
  assert.equal(allStats.byGrade[1].gradeId, 'g2');
  assert.equal(allStats.byGrade[1].annualTotal, 2); // مريم 2

  assert.equal(allStats.byClass.length, 2);
  assert.equal(allStats.byClass[0].classId, 'c1');
  assert.equal(allStats.byClass[0].annualTotal, 4);

  const s1Only = E.computeCumulativeAbsenceStats(db, { refDate: '2027-01-15', studentId: 's1' });
  assert.equal(s1Only.annualTotalAbsences, 3);
  assert.equal(s1Only.byStudent.length, 1);
  assert.equal(s1Only.byStudent[0].name, 'سارة أحمد');

  const g2Only = E.computeCumulativeAbsenceStats(db, { refDate: '2027-01-15', gradeId: 'g2' });
  assert.equal(g2Only.annualTotalAbsences, 2);
});

test('5) تطور الغياب خلال أشهر العام الدراسي + الإجمالي التراكمي الجاري + الرسم البياني', () => {
  const E = loadAbsenceEngine();
  const db = makeSampleDB();
  const stats = E.computeCumulativeAbsenceStats(db, { refDate: '2027-01-15' });

  const sep = stats.monthlySeries.find(m => m.key === '2026-09');
  const oct = stats.monthlySeries.find(m => m.key === '2026-10');
  const nov = stats.monthlySeries.find(m => m.key === '2026-11');
  const dec = stats.monthlySeries.find(m => m.key === '2026-12');
  const jan = stats.monthlySeries.find(m => m.key === '2027-01');

  assert.equal(sep.count, 2); assert.equal(sep.cumulativeTotal, 2);
  assert.equal(oct.count, 2); assert.equal(oct.cumulativeTotal, 4);
  assert.equal(nov.count, 1); assert.equal(nov.cumulativeTotal, 5);
  assert.equal(dec.count, 0); assert.equal(dec.cumulativeTotal, 5);
  assert.equal(jan.count, 1); assert.equal(jan.cumulativeTotal, 6);

  const chart = E.buildAcademicYearAbsenceChart(stats, { clickable: true });
  assert.ok(chart.html.includes('سبتمبر'));
  assert.ok(chart.html.includes('يناير'));
  assert.ok(chart.html.includes('تراكمي 6'));
});

test('6) قائمة الأعوام الدراسية المتاحة + بنية لوحة التحكم والتقارير', () => {
  const E = loadAbsenceEngine();
  const db = makeSampleDB();
  const years = E.listAcademicYears(db, '2027-01-15');
  assert.equal(years.length, 2);
  assert.equal(years[0].label, '2026 / 2027');
  assert.equal(years[1].label, '2025 / 2026');

  assert.ok(HTML.includes('id="academicYearSummaryBox"'));
  assert.ok(HTML.includes('id="academicYearChartBox"'));
  assert.ok(HTML.includes('renderCumulativeAbsenceReport'));
});

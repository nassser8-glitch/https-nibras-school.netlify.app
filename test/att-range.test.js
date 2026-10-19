'use strict';
/* =============================================================================
 * تنقّل مدى الغياب (تحليلات مقارنة الغياب) — اختبارات
 * -----------------------------------------------------------------------------
 * تتحقق من: النافذة الافتراضية (آخر ٥ أيام)، التنقل للخلف/الأمام بلا تكرار ولا
 * تجاوز لليوم، اختيار التاريخ يدويًا، مطابقة الأعداد لسجلات الحضور الفعلية،
 * التفريق بين «صفر غياب» و«لا بيانات»، احتساب المتأخر حاضرًا، ومنع العدّ المزدوج.
 * تنفّذ الدوال الحقيقية من public/index.html داخل vm.
 * تشغيل: node --test test/att-range.test.js
 * ========================================================================== */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

function sliceBetween(src, a, b) {
  const i = src.indexOf(a);
  assert.ok(i >= 0, 'مقطع مفقود: ' + a);
  const j = src.indexOf(b, i + a.length);
  assert.ok(j >= 0, 'نهاية مفقودة بعد: ' + a);
  return src.slice(i, j);
}
function extractFn(src, name) {
  let start = src.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'دالة مفقودة: ' + name);
  const kw = src.slice(Math.max(0, start - 7), start);
  if (/async\s$/.test(kw)) start -= 6;
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('دالة غير مغلقة: ' + name);
}

const FN_NAMES = [
  '__dsToDate', '__dateToDs', '__addDays', '__attDefaultRange', '__attRangeDays',
  '__attShiftRange', '__attRangeFromInputs', '__attAtEnd', '__attRangeLabel',
  '__attRangeSummary', 'buildRangeChart',
];
const CODE = [
  sliceBetween(SRC, 'function attCountsByDate(', '/* تاريخ طالب واحد'),
  sliceBetween(SRC, 'const __ATT_DAY_NAMES', 'function __dsToDate('),
  FN_NAMES.map(n => extractFn(SRC, n)).join('\n'),
  ';globalThis.API = {' + FN_NAMES.join(', ') + ', attCountsByDate};',
].join('\n');

function api() {
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(CODE, ctx);
  return ctx.API;
}

/* بيئة ثانية تشمل دوال الواجهة والتنقل مع DOM وهمي بسيط */
const UI_FNS = ['__attRangeEnsure', '__attRangeControlsHtml', '__attWeekRerender', '__attWeekNav', '__attWeekReset', '__attWeekApply', '__analyticsIds', '__todayDsLocal'];
const UI_CODE = [
  sliceBetween(SRC, 'function attCountsByDate(', '/* تاريخ طالب واحد'),
  sliceBetween(SRC, 'const __ATT_DAY_NAMES', 'function __dsToDate('),
  FN_NAMES.concat(UI_FNS).map(n => extractFn(SRC, n)).join('\n'),
  ';globalThis.API = {' + FN_NAMES.concat(UI_FNS).join(', ') + ', attCountsByDate};',
].join('\n');
function uiApi(opts) {
  const o = opts || {};
  const els = {};
  ['weekChartBox', 'attRangeLabel', 'attRangeFrom', 'attRangeTo', 'attNextBtn'].forEach(id => {
    els[id] = { id, innerHTML: '', textContent: '', value: '', disabled: false, style: {}, title: '' };
  });
  const ctx = {
    console,
    window: {},
    document: { getElementById: id => els[id] || null },
    todayStr: () => (o.today || '2026-10-19'),
    getVisibleStudents: () => ((o.db && o.db.students) || []).filter(s => s.active),
  };
  vm.createContext(ctx);
  vm.runInContext(UI_CODE, ctx);
  ctx.API.__els = els;
  ctx.API.__win = ctx.window;
  return ctx.API;
}

/* بيانات اختبار: s1 غائب (بسجلّين مكرّرين)، s2 متأخر، s3 حاضر */
function sampleDb() {
  return {
    students: [{ id: 's1', active: true }, { id: 's2', active: true }, { id: 's3', active: true }],
    attendance: [
      { studentId: 's1', date: '2026-10-15', status: 'ABSENT' },
      { studentId: 's1', date: '2026-10-15', status: 'ABSENT' }, // سجل مكرّر (مزامنة)
      { studentId: 's2', date: '2026-10-15', status: 'LATE' },
      { studentId: 's1', date: '2026-10-17', status: 'PRESENT' },
      { studentId: 's3', date: '2026-10-17', status: 'PRESENT' },
    ],
  };
}
const IDS = ['s1', 's2', 's3'];

/* ============================ 1) النافذة الافتراضية ============================ */
test('1) آخر ٥ أيام تقويمية بما فيها اليوم، بتواريخ صحيحة', () => {
  const A = api();
  const r = A.__attDefaultRange('2026-10-19');
  assert.strictEqual(r.from, '2026-10-15');
  assert.strictEqual(r.to, '2026-10-19');
  const days = A.__attRangeDays(r);
  assert.strictEqual(days.length, 5);
  assert.strictEqual(days[0], '2026-10-15');
  assert.strictEqual(days[4], '2026-10-19', 'اليوم غير مشمول');
});

test('1ب) عبور حدود الشهر يحسب التواريخ بشكل صحيح', () => {
  const A = api();
  const r = A.__attDefaultRange('2026-11-02');
  assert.strictEqual(r.from, '2026-10-29');
  assert.strictEqual(r.to, '2026-11-02');
  assert.deepStrictEqual([...A.__attRangeDays(r)], ['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
});

/* ============ 2) الانتقال إلى الأيام الخمسة السابقة =========================== */
test('2) «الأيام الخمسة السابقة» تُظهر الفترة السابقة مباشرة', () => {
  const A = api();
  const r = A.__attShiftRange({ from: '2026-10-15', to: '2026-10-19' }, -1, '2026-10-19');
  assert.strictEqual(r.from, '2026-10-10');
  assert.strictEqual(r.to, '2026-10-14');
  assert.strictEqual(r.moved, true);
  assert.strictEqual(A.__attRangeDays(r).length, 5);
});

test('1ج/2ب) التنقل للخلف مرات متعددة: لا تكرار ولا فقدان أيام', () => {
  const A = api();
  let r = A.__attDefaultRange('2026-10-19');
  const seen = [];
  for (let i = 0; i < 6; i++) { A.__attRangeDays(r).forEach(d => seen.push(d)); r = A.__attShiftRange(r, -1, '2026-10-19'); }
  assert.strictEqual(seen.length, 30, 'عدد الأيام الكلي غير متوقع');
  assert.strictEqual(new Set(seen).size, 30, 'تكرار أيام بين النوافذ');
  assert.strictEqual(seen[0], '2026-10-15');
  assert.strictEqual(seen[4], '2026-10-19');
  assert.strictEqual(seen[29], '2026-09-24');
});

/* ============================ الأمام بلا تجاوز اليوم ============================ */
test('2ج) الانتقال للأمام خمسة أيام عند الإمكان', () => {
  const A = api();
  const r = A.__attShiftRange({ from: '2026-10-05', to: '2026-10-09' }, 1, '2026-10-19');
  assert.strictEqual(r.from, '2026-10-10');
  assert.strictEqual(r.to, '2026-10-14');
  assert.strictEqual(r.moved, true);
});

test('2د) لا انتقال للأمام عند الوصول لليوم', () => {
  const A = api();
  const r = A.__attShiftRange({ from: '2026-10-15', to: '2026-10-19' }, 1, '2026-10-19');
  assert.strictEqual(r.moved, false);
  assert.strictEqual(r.from, '2026-10-15');
  assert.strictEqual(r.to, '2026-10-19');
});

test('2هـ) الانتقال للأمام يقتصر على اليوم بدل تجاوزه', () => {
  const A = api();
  const r = A.__attShiftRange({ from: '2026-10-13', to: '2026-10-17' }, 1, '2026-10-18');
  assert.strictEqual(r.to, '2026-10-18', 'تجاوز اليوم');
  assert.strictEqual(r.from, '2026-10-18', 'النافذة الجزئية الأخيرة');
  assert.strictEqual(A.__attRangeDays(r).length, 1);
  // ولا تتكرر أيام النافذة السابقة
  const prev = A.__attRangeDays({ from: '2026-10-13', to: '2026-10-17' });
  const next = A.__attRangeDays(r);
  assert.strictEqual(next.some(d => prev.includes(d)), false, 'تداخل بين النافذتين');
});

/* ============================ اختيار التاريخ يدويًا ============================ */
test('3) النطاق اليدوي: صالح، مقلوب، ومقتصر على اليوم', () => {
  const A = api();
  const a = A.__attRangeFromInputs('2026-10-01', '2026-10-05', '2026-10-19');
  assert.strictEqual(a.from, '2026-10-01'); assert.strictEqual(a.to, '2026-10-05');
  const b = A.__attRangeFromInputs('2026-10-05', '2026-10-01', '2026-10-19');
  assert.strictEqual(b.from, '2026-10-01');
  assert.strictEqual(b.to, '2026-10-05', 'لم يُقلب المعكوس');
  const c = A.__attRangeFromInputs('2026-10-01', '2026-12-31', '2026-10-19');
  assert.strictEqual(c.to, '2026-10-19', 'لم يُقتصر على اليوم');
  assert.strictEqual(A.__attRangeFromInputs('', '2026-10-01', '2026-10-19'), null);
  assert.strictEqual(A.__attRangeFromInputs('ليس تاريخًا', '2026-10-01', '2026-10-19'), null);
});

/* ============================ مطابقة الأعداد للحضور ============================ */
test('4) الأعداد تطابق سجلات الحضور الفعلية لكل يوم', () => {
  const A = api();
  const rows = A.__attRangeSummary(buildDb(), ['s1', 's2', 's3'], { from: '2026-10-15', to: '2026-10-17' });
  assert.strictEqual(rows.length, 3);
  assert.strictEqual(rows[0].ds, '2026-10-15');
  assert.strictEqual(rows[0].absent, 1);
  assert.strictEqual(rows[0].late, 1);
  assert.strictEqual(rows[0].present, 1);
  assert.strictEqual(rows[2].ds, '2026-10-17');
  assert.strictEqual(rows[2].absent, 0);
  assert.strictEqual(rows[2].present, 3);
});

function buildDb() {
  return {
    attendance: [
      { studentId: 's1', date: '2026-10-15', status: 'ABSENT' },
      { studentId: 's1', date: '2026-10-15', status: 'ABSENT' },   // تكرار مزامنة
      { studentId: 's2', date: '2026-10-15', status: 'LATE' },
      { studentId: 's3', date: '2026-10-17', status: 'PRESENT' },
      { studentId: 's1', date: '2026-10-17', status: 'PRESENT' },
    ],
  };
}

test('4ب) الطالب المتأخر يُحتسب حاضرًا لا غائبًا', () => {
  const A = api();
  const rows = A.__attRangeSummary(buildDb(), ['s1', 's2', 's3'], { from: '2026-10-15', to: '2026-10-15' });
  assert.strictEqual(rows[0].absent, 1, 'التأخر حُوِّل إلى غياب');
  assert.strictEqual(rows[0].late, 1);
  assert.strictEqual(rows[0].present, 1);
});

test('4ج) لا عدّ مزدوج للطالب نفسه في اليوم (تكرار المزامنة)', () => {
  const A = api();
  const rows = A.__attRangeSummary(buildDb(), ['s1', 's2', 's3'], { from: '2026-10-15', to: '2026-10-15' });
  assert.strictEqual(rows[0].absent, 1, 'احتسب س1 غائبًا أكثر من مرة');
});

test('4د) الاحتساب يتوافق مع attCountsByDate مباشرة', () => {
  const A = api();
  const db = buildDb();
  const cc = A.attCountsByDate(db, '2026-10-15', ['s1', 's2', 's3']);
  const row = A.__attRangeSummary(db, ['s1', 's2', 's3'], { from: '2026-10-15', to: '2026-10-15' })[0];
  assert.strictEqual(row.absent, cc.absent);
  assert.strictEqual(row.late, cc.late);
  assert.strictEqual(row.present, cc.present);
});

/* ============================ الأيام بلا بيانات ============================ */
test('5) التفريق بين «صفر غياب» و«لا بيانات»', () => {
  const A = api();
  const rows = A.__attRangeSummary(buildDb(), ['s1', 's2', 's3'], { from: '2026-10-15', to: '2026-10-17' });
  assert.strictEqual(rows[1].ds, '2026-10-16');
  assert.strictEqual(rows[1].hasData, false, 'يوم بلا سجلات حُسب بيانات مكتملة');
  assert.strictEqual(rows[0].hasData, true, 'يوم له سجلات لم يُعتبر بيانات');
  assert.strictEqual(rows[2].hasData, true);
});

test('5ب) الرسم يعرض «لا بيانات» لليوم غير المسجّل وليس صفرًا', () => {
  const A = api();
  const res = A.buildRangeChart(buildDb(), ['s1', 's2', 's3'], { from: '2026-10-15', to: '2026-10-17' });
  assert.ok(res.html.includes('لا بيانات'), 'لا تمييز لليوم غير المسجّل');
  assert.ok(/att-range-col[^>]*title="2026-10-16[^"]*لا توجد بيانات/.test(res.html), 'لا عنوان توضيحي لليوم الفارغ');
  assert.ok(res.html.includes('att-range-none'), 'نمط اليوم بلا بيانات مفقود');
});

/* ============================ بناء الرسم ============================ */
test('6) الرسم يحوي عمودًا لكل يوم مع الرقم والتاريخ', () => {
  const A = api();
  const res = A.buildRangeChart(buildDb(), ['s1', 's2', 's3'], { from: '2026-10-15', to: '2026-10-19' });
  assert.strictEqual(res.rows.length, 5);
  assert.strictEqual((res.html.match(/att-range-col/g) || []).length, 5, 'عدد أعمدة الرسم غير مطابق');
  assert.ok(res.html.includes('>1<'), 'عدد الغياب ليوم 2026-10-15 غير ظاهر');
  assert.ok(res.html.includes('10-15') && res.html.includes('10-19'), 'تواريخ الأعمدة غير ظاهرة');
  assert.ok(res.sig.includes('2026-10-15') && res.sig.includes('2026-10-19'), 'توقيع النطاق لا يشمل المدى');
});

test('5ج) التسمية تُظهر من/إلى وعدد الأيام', () => {
  const A = api();
  const lbl = A.__attRangeLabel({ from: '2026-10-15', to: '2026-10-19' });
  assert.ok(lbl.includes('2026-10-15') && lbl.includes('2026-10-19') && lbl.includes('5'));
});

test('5د) __attAtEnd يميّز آخر نطاق', () => {
  const A = api();
  assert.strictEqual(A.__attAtEnd({ from: '2026-10-15', to: '2026-10-19' }, '2026-10-19'), true);
  assert.strictEqual(A.__attAtEnd({ from: '2026-10-10', to: '2026-10-14' }, '2026-10-19'), false);
});

/* ============================ الاتصال بالواجهة ============================ */
test('6ب) الواجهة تحتوي أزرار التنقل ومعالجاتها', () => {
  assert.ok(SRC.includes('onclick="__attWeekNav(-1)"'), 'زر الأيام السابقة مفقود');
  assert.ok(SRC.includes('onclick="__attWeekNav(1)"'), 'زر الأيام التالية مفقود');
  assert.ok(SRC.includes('onclick="__attWeekReset()"'), 'زر العودة مفقود');
  assert.ok(SRC.includes('onclick="__attWeekApply()"'), 'زر عرض النتائج مفقود');
  assert.ok(SRC.includes('◀ الأيام الخمسة السابقة'), 'نص زر السابقة مفقود');
  assert.ok(SRC.includes('الأيام الخمسة التالية ▶'), 'نص زر التالية مفقود');
  assert.ok(SRC.includes('📅 آخر ٥ أيام'), 'نص زر العودة مفقود');
});

test('6ج) renderCharts يستخدم الرسم القابل للتنقل ويحفظ بيانات المصدر', () => {
  const rc = extractFn(SRC, 'renderCharts');
  assert.ok(rc.includes('buildRangeChart'), 'renderCharts لا يستخدم buildRangeChart');
  assert.ok(rc.includes('__attRangeControlsHtml'), 'لا أدوات تنقل');
  assert.ok(rc.includes('window.__chartsData = d'), 'لا يحفظ بيانات المصدر');
  assert.ok(rc.includes('id="weekChartBox"'), 'حاوية الرسم مفقودة');
});

test('6د) التحديث الدوري يعيد رسم النطاق الحالي من بيانات الخادم', () => {
  const fn = extractFn(SRC, '__refreshAnalyticsCharts');
  assert.ok(fn.includes('window.__chartsData = d'), 'التحديث لا يحدّث بيانات المصدر');
  assert.ok(fn.includes('__attWeekRerender()'), 'التحديث لا يعيد رسم النطاق');
  assert.ok(fn.includes('__analyticsIds(d)'), 'التحديث لا يحترم فلترة الطلاب');
});

test('6هـ) الفلاتر محفوظة: الرسم يعتمد الطلاب المرئيين', () => {
  const fn = extractFn(SRC, '__analyticsIds');
  assert.ok(fn.includes('getVisibleStudents()'), 'لا يحترم مرئي الطلاب');
  assert.ok(/s\.active/.test(fn), 'لا يشترط النشاط');
});

/* ============================ عدم كسر الحفظ/القواعد ============================ */
test('7) لم تُمسّ قواعد العدّ ولا حفظ الحضور', () => {
  assert.ok(SRC.includes('function attCountsByDate('), 'attCountsByDate مفقودة');
  assert.ok(SRC.includes('function __attEffStatus('), '__attEffStatus مفقودة');
  assert.ok(SRC.includes('function saveAttendance('), 'saveAttendance مفقودة');
  const seg = sliceBetween(SRC, 'function attCountsByDate(', '/* تاريخ طالب واحد');
  assert.ok(seg.includes('agg') && seg.includes('absent') && seg.includes('records'), 'منطق العدّ تغيّر');
});

test('7ب) النافذة الافتراضية لا تتجاوز اليوم', () => {
  const fn = extractFn(SRC, '__attRangeEnsure');
  assert.ok(/__attRange\.to > today/.test(fn), 'لا قصّ للنطاق عند اليوم');
  assert.ok(fn.includes('__attDefaultRange'), 'لا افتراضي');
});

/* ============================ سلوك الواجهة فعليًا ============================ */
function uiDb() {
  return { students: [{ id: 's1', active: true }, { id: 's2', active: true }, { id: 's3', active: true }], attendance: buildDb().attendance };
}
function uiReady() {
  const db = uiDb();
  const A = uiApi({ db, today: '2026-10-19' });
  A.__win.__chartsData = db;
  A.__win.__attRange = { from: '2026-10-15', to: '2026-10-19' };
  return A;
}

test('8) زر «الأيام الخمسة السابقة» يعيد الرسم ويحدّث النافذة والحقول', () => {
  const A = uiReady();
  A.__attWeekRerender();
  assert.ok(A.__els.weekChartBox.innerHTML.includes('10-15'), 'لم يُرسم النطاق الحالي');
  A.__attWeekNav(-1);
  assert.strictEqual(A.__win.__attRange.from, '2026-10-10');
  assert.strictEqual(A.__win.__attRange.to, '2026-10-14');
  assert.ok(A.__els.weekChartBox.innerHTML.includes('10-10'), 'الرسم لم يتحدّث بعد التنقل');
  assert.ok(A.__els.attRangeLabel.textContent.includes('2026-10-10'), 'التسمية لم تتحدّث');
  assert.strictEqual(A.__els.attRangeFrom.value, '2026-10-10', 'حقل «من» لم يتحدّث');
  assert.strictEqual(A.__els.attRangeTo.value, '2026-10-14', 'حقل «إلى» لم يتحدّث');
});

test('8ب) زر «آخر ٥ أيام» يعود لليوم ويعطّل زر التالي', () => {
  const A = uiReady();
  A.__attWeekNav(-1);
  A.__attWeekReset();
  assert.strictEqual(A.__win.__attRange.from, '2026-10-15');
  assert.strictEqual(A.__win.__attRange.to, '2026-10-19');
  assert.strictEqual(A.__els.attNextBtn.disabled, true, 'زر التالي يجب أن يُعطّل عند اليوم');
  A.__attWeekNav(1);
  assert.strictEqual(A.__win.__attRange.to, '2026-10-19', 'تجاوز اليوم عند التقدّم');
});

test('8ج) زر «عرض النتائج» يطبّق التاريخ اليدوي ويقتصر على اليوم', () => {
  const A = uiReady();
  A.__els.attRangeFrom.value = '2026-10-01';
  A.__els.attRangeTo.value = '2026-10-05';
  A.__attWeekApply();
  assert.strictEqual(A.__win.__attRange.from, '2026-10-01');
  assert.strictEqual(A.__win.__attRange.to, '2026-10-05');
  assert.ok(A.__els.weekChartBox.innerHTML.includes('10-01'));
  A.__els.attRangeFrom.value = '2026-10-01';
  A.__els.attRangeTo.value = '2026-12-31';
  A.__attWeekApply();
  assert.strictEqual(A.__win.__attRange.to, '2026-10-19', 'تجوز اليوم في الاختيار اليدوي');
});

test('8د) أدوات التنقل تحوي الأزرار والحقول الثلاثة', () => {
  const A = uiApi({ today: '2026-10-19' });
  const html = A.__attRangeControlsHtml({ from: '2026-10-15', to: '2026-10-19' });
  assert.ok(html.includes('__attWeekNav(-1)') && html.includes('__attWeekNav(1)'));
  assert.ok(html.includes('__attWeekReset()') && html.includes('__attWeekApply()'));
  assert.ok(html.includes('id="attRangeFrom"') && html.includes('id="attRangeTo"'));
  assert.ok(html.includes('disabled') && html.includes('id="attNextBtn"'), 'زر التالي غير معطّل عند اليوم');
  assert.ok(A.__attRangeControlsHtml({ from: '2026-10-10', to: '2026-10-14' }).indexOf('disabled') < 0, 'زر التالي معطّل خطأً');
});

test('8هـ) التنقل للخلف مرارًا يُظهر بيانات النطاقات الأقدم فعليًا', () => {
  const db = {
    students: [{ id: 's1', active: true }, { id: 's2', active: true }],
    attendance: [{ studentId: 's1', date: '2026-10-02', status: 'ABSENT' }],
  };
  const A = uiApi({ db, today: '2026-10-19' });
  A.__win.__chartsData = db;
  A.__win.__attRange = { from: '2026-10-15', to: '2026-10-19' };
  // ثلاث نقرات للخلف ⇒ النطاق 09-30..10-04 يضم 2026-10-02
  A.__attWeekNav(-1); A.__attWeekNav(-1); A.__attWeekNav(-1);
  assert.strictEqual(A.__win.__attRange.from, '2026-09-30');
  assert.strictEqual(A.__win.__attRange.to, '2026-10-04');
  assert.ok(A.__els.weekChartBox.innerHTML.includes('10-02'), 'اليوم القديم لم يظهر');
});

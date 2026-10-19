const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

function sliceBetween(src, a, b){
  const i = src.indexOf(a);
  if(i < 0) throw new Error('end not found: ' + a);
  const j = src.indexOf(b, i + a.length);
  if(j < 0) throw new Error('end not found: ' + b);
  return src.slice(i, j);
}
function extractFn(src, name){
  const token = 'function ' + name + '(';
  const idx = src.indexOf(token);
  if(idx < 0) throw new Error('fn not found: ' + name);
  let i = src.indexOf('{', idx);
  let depth = 0;
  for(; i < src.length; i++){
    const ch = src[i];
    if(ch === '{') depth++;
    else if(ch === '}'){ depth--; if(depth === 0) return src.slice(idx, i + 1); }
  }
  throw new Error('unbalanced fn: ' + name);
}

const FN_NAMES = ['__bizDsToDate', '__bizDateToDs', '__bizWeekMonday', '__weekRange', '__weekDays', '__weekRangeLabel', '__analyticsIds', 'buildWeekChart', '__weekRerender', '__weekPrev', '__weekNext'];
const CODE = [
  sliceBetween(SRC, 'function attCountsByDate(', '/* تاريخ طالب واحد'),
  FN_NAMES.map(n => extractFn(SRC, n)).join('\n'),
  ';globalThis.API = { attCountsByDate, ' + FN_NAMES.join(', ') + ' };',
].join('\n');

function makeEls(){
  const els = {};
  ['weekChartBox', 'weekChartRange', 'attWeekNext'].forEach(id => { els[id] = { id, innerHTML: '', textContent: '', disabled: false }; });
  return els;
}
function api(today, els){
  const ctx = {
    console,
    window: {},
    document: { getElementById: id => (els && els[id]) || null },
    todayStr: () => today || '2026-10-19',
  };
  vm.createContext(ctx);
  vm.runInContext(CODE, ctx);
  ctx.API.__win = ctx.window;
  ctx.API.__els = els;
  return ctx.API;
}
function db(){
  return {
    students: [{ id: 's1', active: true }, { id: 's2', active: true }, { id: 's3', active: true }, { id: 'sx', active: false }],
    attendance: [
      { studentId: 's1', date: '2026-10-23', status: 'ABSENT' },
      { studentId: 's2', date: '2026-10-23', status: 'LATE' },
      { studentId: 's3', date: '2026-10-22', status: 'ABSENT' },
      { studentId: 's1', date: '2026-10-24', status: 'ABSENT' },
      { studentId: 's2', date: '2026-10-25', status: 'ABSENT' },
    ],
  };
}

test('1) الافتراضي = الأسبوع الحالي إثنين→جمعة، بلا سبت/أحد', () => {
  const A = api();
  const days = [...A.__weekDays(0, '2026-10-19')];
  assert.strictEqual(days.length, 5);
  assert.deepStrictEqual(days, ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23']);
  days.forEach(ds => {
    const g = A.__bizDsToDate(ds).getDay();
    assert.ok(g !== 0 && g !== 6, 'ظهر سبت/أحد: ' + ds);
  });
  assert.strictEqual(A.__bizDsToDate(days[0]).getDay(), 1, 'البداية ليست إثنينًا');
  assert.strictEqual(A.__bizDsToDate(days[4]).getDay(), 5, 'النهاية ليست جمعة');
});

test('2) النافذة = أسبوع اليوم الحالي (إثنين→الجمعة القادمة)، والسبت/الأحد يتبعان نفس الأسبوع', () => {
  const A = api();
  const win = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23'];
  ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'].forEach(t => {
    assert.deepStrictEqual([...A.__weekDays(0, t)], win, 'اختلفت النافذة ليوم ' + t);
  });
  // أسبوع سابق
  assert.deepStrictEqual([...A.__weekDays(0, '2026-10-15')], ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']);
  assert.deepStrictEqual([...A.__weekDays(0, '2026-10-11')], ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']);
});

test('3) التنقّل للخلف: كل خطوة ٧ أيام بلا تكرار أو تجاوز', () => {
  const A = api();
  const w0 = [...A.__weekDays(0, '2026-10-19')];
  const w1 = [...A.__weekDays(1, '2026-10-19')];
  const w2 = [...A.__weekDays(2, '2026-10-19')];
  assert.deepStrictEqual(w0, ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23']);
  assert.deepStrictEqual(w1, ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']);
  assert.deepStrictEqual(w2, ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']);
  assert.strictEqual(w1.some(d => w0.includes(d)), false, 'تداخل بين نافذتين');
  assert.strictEqual(w2.some(d => w1.includes(d)), false, 'تداخل بين نافذتين');
});

test('4) تسمية الفترة', () => {
  const A = api();
  assert.strictEqual(A.__weekRangeLabel({ from: '2026-10-19', to: '2026-10-23' }), '19/10 – 23/10');
  assert.strictEqual(A.__weekRangeLabel({ from: '2026-10-05', to: '2026-10-09' }), '05/10 – 09/10');
  assert.strictEqual(A.__weekRangeLabel(null), '');
});

test('5) الرسم: ٥ أعمدة بأيام العمل، والأعداد مطابقة للسجلات الفعلية', () => {
  const A = api('2026-10-19');
  const d = db();
  const ids = ['s1', 's2', 's3'];
  const res = A.buildWeekChart(d, ids, 0);
  assert.ok(res.html, 'لا يوجد رسم');
  assert.strictEqual((res.html.match(/max-width:26px/g) || []).length, 5, 'عدد الأعمدة ليس ٥');
  assert.ok(!res.html.includes('السبت') && !res.html.includes('الأحد'), 'ظهر سبت/أحد');
  assert.ok(res.html.includes('الإثنين') && res.html.includes('الجمعة'), 'أسماء الأيام ناقصة');

  const dates = (res.html.match(/title="(\d{4}-\d{2}-\d{2})"/g) || []).map(s => s.slice(7, 17));
  assert.deepStrictEqual(dates, ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23']);
  dates.forEach(ds => { const g = A.__bizDsToDate(ds).getDay(); assert.ok(g >= 1 && g <= 5, 'تاريخ نهاية أسبوع: ' + ds); });

  const cc23 = A.attCountsByDate(db(), '2026-10-23', ['s1', 's2', 's3']);
  assert.deepStrictEqual([cc23.present, cc23.absent, cc23.late], [1, 1, 1]);
  assert.ok(res.html.includes('1/1/1'), 'أعداد 23/10 غير مطابقة');
  const cc22 = A.attCountsByDate(db(), '2026-10-22', ['s1', 's2', 's3']);
  assert.deepStrictEqual([cc22.present, cc22.absent, cc22.late], [2, 1, 0]);
  assert.ok(res.html.includes('2/1/0'), 'أعداد 22/10 غير مطابقة');
  assert.strictEqual(res.label, '19/10 – 23/10');
});

test('6) المتأخر حاضر لا غائب، وسجلات نهاية الأسبوع مهمَلة تمامًا', () => {
  const A = api('2026-10-19');
  const ids = ['s1', 's2', 's3'];
  const cc = A.attCountsByDate(db(), '2026-10-23', ids);
  assert.strictEqual(cc.absent, 1, 'المتأخر حُسب غائبًا');
  assert.strictEqual(cc.late, 1);
  const d = db();
  const withWeekend = A.buildWeekChart(d, ids, 0);
  const withoutWeekend = A.buildWeekChart({ students: d.students, attendance: d.attendance.filter(a => ['2026-10-24', '2026-10-25'].indexOf(a.date) < 0) }, ids, 0);
  assert.strictEqual(withoutWeekend.sig, withWeekend.sig, 'سجلات نهاية الأسبوع أثّرت على الرسم');
});

test('7) __analyticsIds يقتصر على الطلاب النشطين', () => {
  const A = api();
  assert.deepStrictEqual([...A.__analyticsIds(db())], ['s1', 's2', 's3']);
});

test('8) الأزرار: السابقة تُزيح أسبوعًا والتالية تعود ولا تتجاوز الأسبوع الحالي', () => {
  const els = makeEls();
  const A = api('2026-10-19', els);
  A.__win.__chartsData = db();
  A.__win.__weekIds = ['s1', 's2', 's3'];
  A.__win.__weekOffset = 0;

  A.__weekRerender();
  assert.strictEqual(els.attWeekNext.disabled, true, 'زر التالية يجب أن يُعطّل عند الأسبوع الحالي');
  assert.ok(els.weekChartRange.textContent.includes('19/10'), 'التسمية الأولية غير صحيحة');
  assert.strictEqual((els.weekChartBox.innerHTML.match(/max-width:26px/g) || []).length, 5, 'لم يُرسم ٥ أعمدة');

  A.__weekPrev();
  assert.strictEqual(A.__win.__weekOffset, 1);
  assert.ok(els.weekChartRange.textContent.includes('12/10'), 'لم تنتقل السابقة أسبوعًا');
  assert.strictEqual(els.attWeekNext.disabled, false, 'زر التالية معطّل خطأً');

  A.__weekNext();
  assert.strictEqual(A.__win.__weekOffset, 0);
  assert.ok(els.weekChartRange.textContent.includes('19/10'), 'لم تعد التالية للأسبوع الحالي');
  assert.strictEqual(els.attWeekNext.disabled, true);

  A.__weekNext();
  assert.strictEqual(A.__win.__weekOffset, 0, 'تجاوزت التالية الأسبوع الحالي');
});

test('9) بنية الواجهة: أزرار التنقّل والمعرّفات باقية مع الأعمدة الأصلية', () => {
  assert.ok(SRC.includes('onclick="__weekPrev()"'), 'زر السابقة مفقود');
  assert.ok(SRC.includes('onclick="__weekNext()"'), 'زر التالية مفقود');
  assert.ok(SRC.includes('id="attWeekNext"') && SRC.includes('id="weekChartRange"'), 'معرّفات التنقّل مفقودة');
  assert.ok(SRC.includes('id="weekChartBox"') && SRC.includes('id="monthChartBox"') && SRC.includes('id="quarterChartBox"'), 'هياكل القسم تغيّرت');
  assert.ok(SRC.includes('.att-week-nav'), 'نمط الأزرار مفقود');
  assert.ok(SRC.includes('background:#16a34a;transition:height .3s') && SRC.includes('background:#dc2626;transition:height .3s') && SRC.includes('background:#d97706;transition:height .3s'), 'ألوان الأعمدة الأصلية تغيّرت');
});

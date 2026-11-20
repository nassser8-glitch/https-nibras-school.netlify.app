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

test('1) ترتيب التقارير من الأحدث إلى الأقدم: قديم وجديد، وتواريخ متساوية بوقت إنشاء ومعرّف ثابت، بلا حذف أو تكرار', () => {
  const code = [
    extractFn(HTML, '__reportTimestampMs'),
    extractFn(HTML, '__reportSortDesc'),
  ].join('\n');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(code, ctx);

  const items = [
    { id: 'r1', date: '2026-09-10', createdAt: '2026-09-10T07:00:00Z' },
    { id: 'r2', date: '2026-11-20', createdAt: '2026-11-20T08:00:00Z' },
    { id: 'r3', date: '2026-11-20', createdAt: '2026-11-20T14:30:00Z' },
    { id: 'r4', date: '2026-11-20', createdAt: '2026-11-20T14:30:00Z' },
    { id: 'r5', date: '2026-10-05', createdAt: '2026-10-05T09:15:00Z' },
  ];
  const origOrder = items.map(x => x.id);
  const sorted = ctx.__reportSortDesc(items, { primary: x => x.date, secondary: x => x.createdAt, id: x => x.id });

  assert.deepEqual(items.map(x => x.id), origOrder, 'لا يجوز تعديل المصفوفة الأصلية');
  assert.equal(sorted.length, items.length, 'لا يجوز اختفاء أو تكرار أي تقرير');
  assert.deepEqual(sorted.map(x => x.id), ['r4', 'r3', 'r2', 'r5', 'r1'], 'الترتيب يجب أن يكون من الأحدث إلى الأقدم مع حسم التساوي بالوقت ثم المعرّف');
});

test('2) عرض الجدول بدون تداخل بصري (كمبيوتر وجوال) مع إخفاء الحقول الداخلية وبحث سريع', () => {
  const code = [
    'function escapeHtml(s){ return String(s==null?"":s).replace(/[&<>"\']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","\'":"&#39;"}[c])); }',
    extractFn(HTML, 'renderReportTable'),
  ].join('\n');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(code, ctx);

  const html = ctx.renderReportTable([
    { 'التاريخ': '2026-11-20', 'الطالبة': 'سارة', 'الحالة': 'غائب', _orphan: false, _noteId: 'n1' },
  ]);
  assert.ok(html.includes('class="report-table-wrap"'), 'الجدول غير مغلّف بحاوية تمرير مانعة للتداخل');
  assert.ok(html.includes('report-data-table'), 'تنسيق الجدول المانع للتداخل مفقود');
  assert.ok(html.includes('data-label="التاريخ"'), 'تسميات البطاقات للجوال data-label مفقودة');
  assert.ok(!html.includes('_orphan') && !html.includes('_noteId'), 'الحقول الداخلية يجب ألا تظهر كأعمدة');
  assert.ok(html.includes('__filterReportSearch'), 'مربع البحث السريع داخل التقرير مفقود');
  assert.ok(HTML.includes('@media (max-width: 720px)') && HTML.includes('.report-data-table tbody tr'), 'قواعد العرض المستقل للبطاقات على الجوال مفقودة');
});

test('3) عدم اختلاط سجلات الكادر مع تقرير فصل محدد، وتحديث الصفحة عند تبديل نوع التقرير', () => {
  assert.ok(HTML.includes("if(!classId && (statusFilter === 'ABSENT' || statusFilter === 'LATE'))"), 'سجلات الكادر ما زالت تختلط مع تقرير الفصل المحدد');
  assert.ok(HTML.includes("onchange=\"reportState.type=this.value;reportState.rows=null;reportState.period='month';renderApp()\""), 'تبديل نوع التقرير لا يمسح نتائج التقرير السابق فورًا');
});

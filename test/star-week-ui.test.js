'use strict';
// اختبارات واجهة «نجمة الأسبوع»: المموحاة (منطق نقي) + ربط الملفات + حارس PUT.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const CLIENT = path.join(ROOT, 'public', 'star-week.js');
const INDEX = path.join(ROOT, 'public', 'index.html');
const SERVER = path.join(ROOT, 'server.js');
const SW = path.join(ROOT, 'public', 'sw.js');

// نحمّل star-week.js في سياق DOM مصغّر لنحصل على دواله النقية كما هي
function loadClient(){
  const src = fs.readFileSync(CLIENT, 'utf8');
  const win = {
    matchMedia: () => ({ matches: false }),
    localStorage: { _d: {}, getItem(k){ return this._d[k] === undefined ? null : this._d[k]; }, setItem(k, v){ this._d[k] = v; } },
    requestAnimationFrame: (f) => { f(); },
    getComputedStyle: () => ({ getPropertyValue: () => '#be185d' }),
    document: { querySelectorAll: () => [], querySelector: () => null, body: {} },
    setTimeout: (f) => f(),
    console
  };
  win.window = win;
  win.fetch = () => Promise.reject(new Error('no network in test'));
  vm.createContext(win);
  vm.runInContext(src, win);
  return win;
}

const zig = (fn) => fn();
const path2d = (pts) => pts.map(([x, y]) => ({ x, y }));

// ══════════ 11) الممحاة تكشف البطاقة ولا تكشف بيانات مختلفة ══════════
test('الممحاة: مسح أفقي متعرّج يصل 100% ويكشف كاملة', () => {
  const w = loadClient();
  const pts = [];
  const rows = 7;
  for (let r = 0; r < rows; r++){
    const y = (r + 0.5) / rows;
    for (let c = 0; c <= 40; c++) pts.push({ x: c / 40, y });
    if (r < rows - 1) pts.push({ x: 1, y: (r + 1.5) / rows }, { x: 0, y: (r + 1.5) / rows });
  }
  const p = w.__stwCoverage(pts);
  assert.ok(p >= 0.995, 'المسح المتعرّج يغطّي المنطقة كلها: ' + p.toFixed(3));
  assert.strictEqual(w.__stwPercentOf(p), 100);
  assert.strictEqual(w.__stwStepOf(p), 4, 'الدرجة الأخيرة 100%');
});

test('الممحاة: نقطة واحدة لا تكشف شيئًا، والتقدّم تدرّجي 25/50/75/100', () => {
  const w = loadClient();
  assert.strictEqual(w.__stwCoverage([]), 0, 'بلا مسح = 0%');
  assert.strictEqual(w.__stwCoverage(null), 0);
  const dot = w.__stwCoverage([{ x: 0.5, y: 0.5 }]);
  assert.ok(dot > 0 && dot < 0.2, 'نقطة واحدة تكشف شريحة صغيرة فقط: ' + dot.toFixed(3));
  // شريط أفقي واحد = نحو النصف (صف واحد من 12)
  const bar = [];
  for (let c = 0; c <= 60; c++) bar.push({ x: c / 60, y: 0.5 });
  const bp = w.__stwCoverage(bar);
  assert.ok(bp > 0.05 && bp < 0.35, 'نصف البطاقة لم يُمسح بعد: ' + bp.toFixed(3));
  // التدرّج: 0 → 1 يمرّ بالدرجات الأربع
  const seen = new Set();
  const all = [];
  for (let r = 0; r < 12; r++) for (let c = 0; c <= 40; c++) all.push({ x: c / 40, y: (r + 0.5) / 12 });
  for (let i = 1; i <= all.length; i++) seen.add(w.__stwStepOf(w.__stwCoverage(all.slice(0, i))));
  for (const s of [0, 1, 2, 3, 4]) assert.ok(seen.has(s), 'الدرجة ' + (s * 25) + '% تظهر أثناء المسح');
});

test('الممحاة: لا تعتمد على hover وتقبل مسارًا متقطعًا (اللمس يبلّغ مواضع متفرقة)', () => {
  const w = loadClient();
  // مسار متقطع: قفزات كبيرة — يجب أن تُوصل المقاطع (لو غُفلتConnector لما اكتمل المسح)
  const jumps = [];
  for (let r = 0; r < 12; r++){
    jumps.push({ x: r % 2 ? 0.05 : 0.95, y: (r + 0.5) / 12 });
    jumps.push({ x: r % 2 ? 0.95 : 0.05, y: (r + 0.5) / 12 });
  }
  const p = w.__stwCoverage(jumps);
  assert.ok(p >= 0.995, 'المسح المتقطع يكمل أيضًا: ' + p.toFixed(3));
});

test('المحو نقيّ: نفس المسار ⇒ نفس النسبة (بلا حالة مخفية)', () => {
  const w = loadClient();
  const pts = path2d([[0.1, 0.1], [0.5, 0.5], [0.9, 0.9]]);
  const a = w.__stwCoverage(pts);
  const b = w.__stwCoverage(pts);
  const c = w.__stwCoverage(pts.map(p => ({ x: p.x, y: p.y })));
  assert.strictEqual(a, b);
  assert.strictEqual(a, c);
});

test('المموحاة: البطاقة المعروضة بعد الكشف مبنية من نفس بيانات النجمة المحفوظة', () => {
  const w = loadClient();
  const star = {
    id: '2026-09-28::C1', weekKey: '2026-09-28', classId: 'C1', className: 'الصف السادس — أ',
    studentId: 'S1', studentName: 'نورة الحربي',
    traits: ['khuluqa', 'mjthda'],
    traitsLabels: ['🌷 خلوقة', '🌟 مجتهدة'],
    message: '(lat:Latin) <b>تحت الاختبار</b>'
  };
  const html = w.__stwCardHTML(star, 'الأسبوع 5');
  assert.ok(html.includes('نورة الحربي'), 'اسم الطالبة');
  assert.ok(html.includes('الصف السادس — أ'), 'الفصل');
  assert.ok(html.includes('الأسبوع 5'), 'رقم الأسبوع');
  assert.ok(html.includes('🌷 خلوقة') && html.includes('🌟 مجتهدة'), 'الصفات المختارة');
  assert.ok(html.includes('&lt;b&gt;'), 'العبارة مُهرَّبة (لا حقن HTML)');
  assert.ok(!html.includes('<b>تحت'), 'لا HTML خام من الخادم');
  // لا حقول حساسة
  assert.ok(!/studentNo|username|phone|email|password/i.test(html), 'لا حقول حساسة في البطاقة');
});

test('المموحاة: الاسم يحتوي HTML من الخادم يُهرَّب', () => {
  const w = loadClient();
  const html = w.__stwCardHTML({ studentName: '<img src=x onerror=alert(1)>', traitsLabels: [] }, 'w');
  assert.ok(!html.includes('<img'), 'وسم محسوب');
  assert.ok(html.includes('&lt;img'), 'مُهرَّب');
});

test('البطاقة تُبنى من نفس كائن الخادم عبر قاعدة واحدة (لا مصدر ثانٍ للبيانات)', () => {
  const w = loadClient();
  // ما لم يرد من الخادم لا يظهر: لا اسم افتراضي، لا صفات وهمية
  const empty = w.__stwCardHTML({ studentName: '', className: '', traits: [] }, '');
  assert.ok(empty.includes('stw-card'), 'البنية موجودة');
  assert.ok(!/اسم|نجمة جديدة تلقائيًا/.test(empty.replace(/<[^>]+>/g, '').replace(/\s/g, '')), 'لا بيانات مخترعة');
});

// ══════════ ربط الملفات ══════════
test('الربط: نقطتا تركيب (طالبات + معلّمين) ووسم السكربت وكاش SW', () => {
  const idx = fs.readFileSync(INDEX, 'utf8');
  assert.strictEqual((idx.match(/data-stw-mount/g) || []).length, 2, 'نقطة تركيب واحدة لكل لوحة');
  assert.ok(idx.includes('star-week.js'), 'وسم السكربت موجود');
  const sw = fs.readFileSync(SW, 'utf8');
  assert.ok(sw.includes("'./star-week.js'"), 'الملف في CORE_ASSETS');
});

test('التركيب داخل لوحتَي renderStudentDashboard و renderDashboard', () => {
  const idx = fs.readFileSync(INDEX, 'utf8').replace(/\r\n/g, '\n');
  const before = idx.slice(0, idx.indexOf('function renderDashboard()'));
  const after = idx.slice(idx.indexOf('function renderDashboard()'));
  const sd = before.slice(before.indexOf('function renderStudentDashboard()'));
  assert.ok(sd.includes('data-stw-mount'), 'داخل لوحة الطالبات');
  assert.ok(after.includes('data-stw-mount'), 'داخل لوحة المعلمين/الإدارة');
});

test('CSS: ثيم وردي + دعم prefers-reduced-motion', () => {
  const idx = fs.readFileSync(INDEX, 'utf8');
  const css = idx.slice(idx.indexOf('<style>'), idx.indexOf('</style>'));
  assert.ok(css.includes('.stw-'), 'أنماط الميزة موجودة');
  assert.ok(css.includes('prefers-reduced-motion: reduce'), 'احترام تقليل الحركة');
  assert.ok(css.includes('var(--primary'), 'الألوان من متغيّرات الثيم');
  assert.ok(css.includes('touch-action:none'), 'اللمس يعمل دون منع تمرير الصفحة');
  // لا ألوان زرقاء مستحدثة في بطاقات الميزة
  const m = css.match(/\.stw-card \{[^}]*\}/);
  assert.ok(m && !/#0f4678|#1e88d6|#1672c4/.test(m[0]), 'لا أزرق في البطاقة');
});

test('الملف لا يستورد express/pg (يبقى قابلًا للاختبار)', () => {
  const s = fs.readFileSync(CLIENT, 'utf8');
  assert.ok(!/require\(\s*['"]express/.test(s));
  const sw2 = fs.readFileSync(path.join(ROOT, 'star-week.js'), 'utf8');
  assert.ok(!/require\(\s*['"](express|pg)/.test(sw2), 'المنطق النقي بلا Express/PG');
});

// ══════════ حارس PUT: لا يُكتب القسم من العميل ══════════
test('حارس PUT: يُسقط stars القادمة من العميل في PUT /api/db/:school', () => {
  const s = fs.readFileSync(SERVER, 'utf8');
  const putAt = s.indexOf("app.put('/api/db/:school'");
  const guardAt = s.indexOf("if ('stars' in data) {", putAt);
  const writeAt = s.indexOf('db.setSchoolData(school, clean', putAt);
  assert.ok(putAt !== -1, 'المسار موجود');
  assert.ok(guardAt !== -1, 'الحارس موجود داخل PUT');
  assert.ok(guardAt < writeAt, 'الحارس قبل الكتابة (لا يُكتب قسم ملوَّث)');
  const guard = s.slice(guardAt, guardAt + 400);
  assert.ok(guard.includes('prev.data'), 'يعيد قيمة الخادم');
  assert.ok(/delete clean\.stars/.test(guard), 'يحذفها إن لم تكن موجودة في الخادم');
  // مسار الاستعادة (استعادة نسخة احتياطية) غير معدّل: النجوم تُستعاد عمدًا
  const restoreAt = s.indexOf("app.post('/api/backups/restore'");
  const afterRestore = s.slice(restoreAt);
  assert.ok(!afterRestore.slice(0, 4000).includes("if ('stars' in data)"), 'الاستعادة لم تُمس');
});

test('مسارات الميزة محمية بـ requireAuth', () => {
  const s = fs.readFileSync(SERVER, 'utf8');
  const routes = [
    "app.get('/api/stars', requireAuth",
    "app.post('/api/stars/award', requireAuth",
    "app.delete('/api/stars/award', requireAuth"
  ];
  for (const r of routes) assert.ok(s.includes(r), 'المسار محمي: ' + r);
  // WRITE path: يستخدم الكتابة mutateSchoolData لا عبر setSchoolData (تفادي سباق القراءة-الكتابة)
  const awardAt = s.indexOf("app.post('/api/stars/award'");
  const body = s.slice(awardAt, s.indexOf("app.delete('/api/stars/award'"));
  assert.ok(body.includes('db.mutateSchoolData'), 'كتابة داخل معاملة مقفلة');
  assert.ok(!body.includes('db.setSchoolData('), 'لا كتابة كاملة للصف');
});

test('حذف النجمة غير مسموح (السجل دائم)', () => {
  const s = fs.readFileSync(SERVER, 'utf8');
  const d = s.slice(s.indexOf("app.delete('/api/stars/award'"));
  assert.ok(d.slice(0, 300).includes('405'), 'DELETE يرفض بـ 405');
});

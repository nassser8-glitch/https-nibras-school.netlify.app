'use strict';
/* =============================================================================
 * بوابة الروابط التعليمية — اختبارات (node:test)
 * -----------------------------------------------------------------------------
 * تقرأ الشيفرة الحقيقية من public/index.html وserver.js وsw.js وdb.js،
 * وتنفّذ الدوال الفعلية داخل vm مع DOM وهمي بسيط.
 * تشغيل: node --test test/edu-links.test.js
 * ========================================================================== */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const SW = fs.readFileSync(path.join(ROOT, 'public', 'sw.js'), 'utf8');
const DB = fs.readFileSync(path.join(ROOT, 'db.js'), 'utf8');
const TOOLBAR = fs.readFileSync(path.join(ROOT, 'public', 'toolbar.js'), 'utf8');

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
function fnHead(src, name, n) {
  const start = src.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'دالة مفقودة: ' + name);
  return src.slice(start, start + (n || 320));
}

/* ------- الشيفرة المُنفَّذة فعليًا (مقاطع حقيقية من index.html) ------- */
const FN_NAMES = [
  'escapeHtml', '__eduValidUrl', '__eduNormalize', '__eduFilter', '__eduGroup',
  '__eduCardHtml', '__eduBodyHtml', '__eduActive', '__eduDefaultList', '__eduIsAdmin',
  '__eduClone', '__eduCatName', '__eduAdminListHtml', '__eduPaintAdmin', '__eduFormOpen',
  '__eduFormSave', '__eduMove', '__eduToggle', '__eduDelete', '__eduResetDefaults',
  '__eduSaveAll', '__eduLoad', '__eduSave', '__eduSearchInput', '__eduPaintBody', '__eduOpenAdmin',
];
const CODE = sliceBetween(SRC, 'const EDU_LINKS_KEY', 'function __eduMirrorKey(') +
  '\n' + FN_NAMES.map(n => extractFn(SRC, n)).join('\n') + `
;globalThis.API = {
  __eduValidUrl, __eduNormalize, __eduFilter, __eduGroup, __eduCardHtml, __eduBodyHtml,
  __eduDefaultList, __eduIsAdmin, __eduActive, __eduLoad, __eduSave, __eduOpenAdmin,
  __eduFormOpen, __eduFormSave, __eduMove, __eduToggle, __eduDelete, __eduResetDefaults,
  __eduSaveAll, __eduSearchInput, __eduPaintBody, EDU_CATS, EDU_LINKS_DEFAULT, EDU_LINK_CAMPUSES,
  setDraft:(v)=>{__eduDraft=v}, getDraft:()=>__eduDraft,
  setEdit:(v)=>{__eduEditId=v}, getEdit:()=>__eduEditId,
  setCache:(v)=>{__eduLinksCache=v}, getCache:()=>__eduLinksCache,
  setTerm:(v)=>{__eduSearchTerm=v}, getTerm:()=>__eduSearchTerm
};
`;
assert.ok(!/\bfunction\s+__edu\w+\([^)]*\)\s*\{\s*paintPlaceholder/.test(CODE), 'placeholder');

/* __eduOpenAdmin ليس ضمن FN_NAMES (يعتمد على __eduClone فقط) — نتحقق وجوده نصيًا */
function buildCtx(env) {
  const e = env || {};
  const dom = Object.assign({
    eduFName: { value: '', focus() {} },
    eduFUrl: { value: '' },
    eduFDesc: { value: '' },
    eduFCat: { value: 'systems' },
    eduFIco: { value: '🔗' },
    eduFErr: { style: {}, textContent: '' },
    eduAdminForm: { innerHTML: '' },
    eduAdminMsg: { innerHTML: '' },
    eduBody: { innerHTML: '' },
  }, e.dom || {});
  const ctx = {
    console,
    URL: URL,
    URLSearchParams: URLSearchParams,
    localStorage: e.localStorage || { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    setTimeout: () => 0,
    document: { getElementById: (id) => (dom[id] !== undefined ? dom[id] : null) },
    confirm: () => !!e.confirm,
    getActiveSchool: () => e.school || 'GIRLS',
    currentUser: () => (e.user === undefined ? { role: 'ADMIN' } : e.user),
    __serverEnabled: () => !!e.online,
    __getSchoolSettings: async (s) => (e.get ? e.get(s) : {}),
    __putSchoolSettings: async (s, d) => (e.put ? e.put(s, d) : false),
    __schoolSettingsCache: e.cache || {},
  };
  vm.createContext(ctx);
  vm.runInContext(CODE, ctx);
  ctx.dom = dom;
  return ctx;
}

/* ============================ 1) المقعدان تبادلا ============================ */
test('1) خانة الطقس عادت إلى الشريط، والروابط التعليمية صارت أول تبويبات الأدوات', () => {
  const strip = extractFn(SRC, 'renderAppStrip');
  assert.ok(strip.includes('strip-weather') && strip.includes('stripWxTemp'), 'لا خانة للطقس في الشريط');
  assert.ok(strip.includes('🌤'), 'لا أيقونة افتراضية للطقس');
  assert.ok(strip.includes('stripHijri') && strip.includes('stripTime'), 'خانة التاريخ تأثرت');
  assert.ok(strip.includes('stripHijri') && strip.includes('stripTime'), 'بيانات التاريخ تأثرت');
  assert.ok(strip.includes('__stripWxRender()'), 'خانة الطقس لا تُرسم عند تجهيز الشريط');
  assert.ok(!strip.includes('strip-edu'), 'خانة الروابط التعليمية ما زالت في الشريط');
  assert.ok(!strip.includes('openEduLinks()'), 'الشريط ما زال يفتح البوابة بعد نقلها');
  assert.ok(SRC.includes('id="appStrip"'), 'شريط الخدمات مفقود');
  /* شبكة الطقس: تقرأ الذاكرة المشتركة ولا تنازش شريط الأدوات في النداء */
  const wx = extractFn(SRC, '__stripWxRender');
  const read = extractFn(SRC, '__stripWxRead');
  assert.ok(read.includes("localStorage.getItem('nibras_tb_v1_weather')"), 'لا قراءة لذاكرة الطقس المشتركة');
  assert.ok(wx.includes('__stripWxRead()'), 'العارض لا يقرأ الذاكرة المشتركة');
  assert.ok(wx.includes('window.__tb.fetchWeather'), 'لا طلب تحديث عبر شريط الأدوات');
  assert.ok(!SRC.includes('api.open-meteo.com'), 'نداء الطقس المكرر ما زال في الصفحة');
  assert.ok(!SRC.includes('stripWeather'), 'stripWeather ما زال في الصفحة');
  /* البوابة انتقلت إلى شريط الأدوات: أول تبويب وأيقونة 🎓 وعارض يفتح النافذة */
  const tabs = /var TABS = \[([\s\S]*?)\];/.exec(TOOLBAR);
  assert.ok(tabs, 'TABS مفقودة من شريط الأدوات');
  assert.ok(/id:\s*'e'/.test(tabs[1]) && tabs[1].includes('🎓'), 'البوابة ليست أول مقعد في شريط الأدوات');
  assert.ok(tabs[1].includes('eduLinksRender'), 'لا عارض للبوابة في الشريط');
  assert.ok(!/id:\s*'w'/.test(tabs[1]), 'تبويب الطقس المقطوع ما زال في الشريط');
  assert.ok(TOOLBAR.includes('openEduLinks'), 'عارض الشريط لا يفتح بوابة التطبيق');
});

/* ============================ 2) الخدمات الأخرى سليمة ============================ */
test('2) خدمة الطقس (ذاكرة الشريط المشتركة) وملفاتها لم تتأثر', () => {
  assert.ok(TOOLBAR.includes('api.open-meteo.com'), 'طقس شريط الأدوات اختفى');
  assert.ok(/fetchWeather/.test(TOOLBAR), 'دالة طقس الشريط اختفت');
  assert.ok(/weatherRender/.test(TOOLBAR), 'عارض الطقس في الشريط اختفى');
  assert.ok(/<script src="toolbar\.js\?v=\d+"><\/script>/.test(SRC), 'سكربت الشريط غير موصول');
  assert.ok(/href="toolbar\.css\?v=\d+"/.test(SRC), 'أنماط الشريط غير موصولة');
  assert.ok(SW.includes('./toolbar.js') && SW.includes('./toolbar.css'), 'ملفات الشريط غير مخزّنة');
  /* رقم إصدار سكربت الشريط نفسه يجب أن يطابق ما في عامل الخدمة */
  const jv = /toolbar\.js\?v=(\d+)/.exec(SRC);
  const js = /toolbar\.js\?v=(\d+)/.exec(SW);
  assert.ok(jv && js && jv[1] === js[1], 'إصدار سكربت الشريط غير متطابق: ' + (jv && jv[1]) + ' vs ' + (js && js[1]));
  for (const fn of ['renderAppStrip', 'renderDashboard', 'renderAttendance', 'renderSettings']) {
    assert.ok(SRC.includes('function ' + fn + '('), 'دالة مفقودة: ' + fn);
  }
});

/* ============================ 3) فتح/إغلاق النافذة ============================ */
test('3) النافذة تُفتح وتُغلق من الزر ومن الخلفية', () => {
  const open = extractFn(SRC, 'openEduLinks');
  assert.ok(open.includes("ov.id = 'eduOverlay'"), 'لا معرّف للنافذة');
  assert.ok(open.includes("ov.className = 'modal-overlay'"), 'لا نمط نافذة');
  assert.ok(/document\.body\.appendChild\(ov\)/.test(open), 'النافذة لا تُضاف للصفحة');
  assert.ok(open.includes('modal-close') && SRC.includes('onclick="closeEduLinks()"'), 'لا زر إغلاق');
  assert.ok(/e\.target === ov[\s\S]*?closeEduLinks\(\)/.test(open), 'النقر على الخلفية لا يغلق');
  const close = extractFn(SRC, 'closeEduLinks');
  assert.ok(/getElementById\('eduOverlay'\)/.test(close) && /\.remove\(\)/.test(close), 'الإغلاق لا يزيل النافذة');
  assert.ok(SRC.includes('🎓 بوابة الروابط التعليمية'), 'لا عنوان');
  assert.ok(SRC.includes('وصول سريع إلى الأنظمة والمنصات التعليمية'), 'لا وصف مختصر');
  assert.ok(SRC.includes('id="eduSearch"') && SRC.includes('id="eduBody"'), 'مكوّنات ناقصة');
  assert.ok(SRC.includes('type="search"'), 'خانة البحث ليست بحثًا');
});

/* ============================ 4) البحث ============================ */
test('4) البحث بالاسم أو الوصف (دالة نقية)', () => {
  const A = buildCtx().API;
  const list = A.__eduNormalize([
    { name: 'نظام نور', url: 'https://noor.moe.gov.sa/', desc: 'النتائج والغياب' },
    { name: 'منصة مدرستي', url: 'https://madrasati.sa/', desc: 'الحصص الافتراضية' },
    { name: 'منصة اعتماد', url: 'https://login.etimad.sa/' },
  ]);
  assert.strictEqual(A.__eduFilter(list, '').length, 3);
  assert.strictEqual(A.__eduFilter(list, 'نور').length, 1);
  assert.strictEqual(A.__eduFilter(list, 'نور')[0].name, 'نظام نور');
  assert.strictEqual(A.__eduFilter(list, 'افتراضية').length, 1);
  assert.strictEqual(A.__eduFilter(list, 'غير موجود').length, 0);
});

test('4ب) __eduSearchInput يضبط المزوّد ولا يرمي', () => {
  const A = buildCtx().API;
  A.setCache(A.__eduDefaultList());
  A.__eduSearchInput('نور');
  assert.strictEqual(A.getTerm(), 'نور');
  assert.ok(typeof buildCtx().dom.eduBody.innerHTML === 'string');
});

/* ============================ 5) التصنيف ============================ */
test('5) التصنيف في ثلاثة أقسام ثابتة (دالة نقية)', () => {
  const A = buildCtx().API;
  const list = A.__eduNormalize([
    { name: 'أ', url: 'https://a.example.com/', cat: 'systems' },
    { name: 'ب', url: 'https://b.example.com/', cat: 'staff' },
    { name: 'ج', url: 'https://c.example.com/', cat: 'staff' },
    { name: 'د', url: 'https://d.example.com/', cat: 'family' },
  ]);
  const groups = A.__eduGroup(list);
  assert.strictEqual(groups.length, 3);
  assert.deepStrictEqual([...groups.map(g => g.cat.id)], ['systems', 'staff', 'family']);
  assert.strictEqual(groups[1].items.length, 2);
  assert.strictEqual(A.__eduGroup([]).length, 0);
});

/* ============================ 5) الافتراضية ============================ */
test('5ب) عشرة روابط افتراضية صحيحة في ثلاثة أقسام', () => {
  const A = buildCtx().API;
  const list = A.__eduDefaultList();
  assert.strictEqual(list.length, 10);
  assert.ok(list.every(l => A.__eduValidUrl(l.url)), 'رابط افتراضي غير صالح');
  assert.ok(list.every(l => A.EDU_CATS.some(cf => cf.id === l.cat)), 'قسم افتراضي غير معروف');
  assert.ok(list.every(l => l.name && l.icon && l.on !== false), 'عنصر افتراضي ناقص');
  const ids = list.map(l => l.id);
  for (const id of ['noor', 'fares', 'edugate', 'etimad', 'abroad']) {
    assert.ok(ids.includes(id), 'خدمة افتراضية مفقودة: ' + id);
  }
  assert.strictEqual(new Set(ids).size, ids.length, 'معرّفات مكرّرة');
  assert.ok(A.EDU_CATS.every(cf => list.some(l => l.cat === cf.id)), 'قسم بلا روابط');
});

/* ============================ 6) البطاقة ============================ */
test('6) البطاقة تفتح الرابط الصحيح في تبويب جديد بأمان', () => {
  const A = buildCtx().API;
  const html = A.__eduCardHtml({ name: 'نظام نور', icon: '🌟', url: 'https://noor.moe.gov.sa/', desc: 'وصف' });
  assert.ok(/<a[^>]*href="https:\/\/noor\.moe\.gov\.sa\/"/.test(html), 'الرابط غير مطابق');
  assert.ok(/target="_blank"/.test(html), 'لا فتح في تبويب جديد');
  assert.ok(/rel="noopener noreferrer nofollow"/.test(html), 'لا rel آمن');
  assert.ok(html.includes('نظام نور'), 'الاسم مفقود');
});

test('6ب) escapeHtml يحمي من إدراج HTML في البطاقة', () => {
  const A = buildCtx().API;
  const html = A.__eduCardHtml({ name: '<img src=x onerror=alert(1)>', icon: '🔗', url: 'https://x.example.com/', desc: '<script>bad()</script>' });
  assert.ok(!/<img src=x/.test(html), '.name غير مُعالج');
  assert.ok(!/<script>/.test(html), '.desc غير مُعالج');
  assert.ok(html.includes('&lt;img'), 'لم يحدث الترميز');
});

/* ============================ 7) تحقق الروابط ============================ */
test('7) رفض الروابط غير الآمنة أو غير الصالحة', () => {
  const A = buildCtx().API;
  assert.strictEqual(A.__eduValidUrl('https://noor.moe.gov.sa/'), true);
  assert.strictEqual(A.__eduValidUrl('http://example.com'), true);
  assert.strictEqual(A.__eduValidUrl(''), false);
  assert.strictEqual(A.__eduValidUrl('   '), false);
  assert.strictEqual(A.__eduValidUrl('javascript:alert(1)'), false);
  assert.strictEqual(A.__eduValidUrl('data:text/html,x'), false);
  assert.strictEqual(A.__eduValidUrl('vbscript:msgbox(1)'), false);
  assert.strictEqual(A.__eduValidUrl('ftp://files.example.com/'), false);
  assert.strictEqual(A.__eduValidUrl('https://no-dot-host'), false);
  assert.strictEqual(A.__eduValidUrl('https://user:pass@example.com/'), false);
  assert.strictEqual(A.__eduValidUrl('https://' + 'a'.repeat(600) + '.com'), false);
});

/* ============================ 8) التطبيع ============================ */
test('8) التطبيع يرفض التالف ويحفظ الحالة والترتيب', () => {
  const A = buildCtx().API;
  const out = A.__eduNormalize([
    { name: 'سيء', url: 'javascript:alert(1)' },
    { name: 'جيد', url: 'https://ok.example.com/', on: false, ord: 2 },
    { name: 'أفضل', url: 'https://best.example.com/', ord: 1 },
    'ليس كائنًا',
    { name: '', url: 'https://x.example.com/' },
  ]);
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[0].name, 'أفضل');
  assert.strictEqual(out[1].name, 'جيد');
  assert.strictEqual(out[1].on, false, 'لم تُحفظ حالة التعطيل');
  assert.strictEqual(out[1].cat, 'systems', 'القسم الافتراضي');
});

/* ============================ 9) الصلاحية ============================ */
test('9) زر الإدارة يظهر للمدير فقط', () => {
  assert.ok(/__eduIsAdmin\(\)\s*\?\s*'<button class="btn-secondary" onclick="__eduOpenAdmin\(\)">/.test(SRC),
    'زر الإدارة غير مقيد بـ __eduIsAdmin');
  assert.ok(SRC.includes('⚙️ إدارة الروابط'), 'لا زر إدارة');
});

test('9ب) __eduIsAdmin مصفوفة أدوار', () => {
  const cases = [['ADMIN', true], ['TEACHER', false], ['STUDENT', false], ['PARENT', false], ['SCHOOL_AGENT', false], ['ADMINISTRATIVE', false]];
  for (const [role, expected] of cases) {
    assert.strictEqual(buildCtx({ user: { role } }).API.__eduIsAdmin(), expected, 'خطأ في الدور ' + role);
  }
  assert.strictEqual(buildCtx({ user: null }).API.__eduIsAdmin(), false, 'بلا مستخدم');
});

test('9ج) كل دوال الإدارة محميّة بفحص ADMIN', () => {
  for (const fn of ['__eduOpenAdmin', '__eduFormOpen', '__eduFormSave', '__eduMove', '__eduToggle', '__eduDelete', '__eduSaveAll', '__eduResetDefaults']) {
    assert.ok(/if\s*\(!__eduIsAdmin\(\)\)\s*return/.test(fnHead(SRC, fn)), 'دالة بلا حماية: ' + fn);
  }
});

/* ============================ 10) الإضافة ============================ */
test('10) إضافة رابط جديد عبر النموذج', () => {
  const c = buildCtx({});
  const A = c.API;
  A.setDraft([]); A.setEdit(null);
  c.dom.eduFName.value = 'منصة جديدة';
  c.dom.eduFUrl.value = 'https://new.example.com/';
  c.dom.eduFDesc.value = 'وصف';
  c.dom.eduFCat.value = 'staff';
  c.dom.eduFIco.value = '🆕';
  A.__eduFormSave();
  const d = A.getDraft();
  assert.strictEqual(d.length, 1);
  assert.strictEqual(d[0].name, 'منصة جديدة');
  assert.strictEqual(d[0].url, 'https://new.example.com/');
  assert.strictEqual(d[0].cat, 'staff');
  assert.strictEqual(d[0].icon, '🆕');
  assert.ok(d[0].id);
});

test('10ب) النموذج يرفض رابطًا غير آمن ولا يضيف', () => {
  const c = buildCtx({});
  const A = c.API;
  A.setDraft([]); A.setEdit(null);
  c.dom.eduFName.value = 'خطر';
  c.dom.eduFUrl.value = 'javascript:alert(1)';
  A.__eduFormSave();
  assert.strictEqual(A.getDraft().length, 0, 'أُضيف رابط غير آمن');
  assert.strictEqual(c.dom.eduFErr.style.display, 'block', 'لا رسالة خطأ');
});

test('10ج) النموذج يرفض الاسم الفارغ', () => {
  const c = buildCtx({});
  const A = c.API;
  A.setDraft([]); A.setEdit(null);
  c.dom.eduFName.value = '';
  c.dom.eduFUrl.value = 'https://ok.example.com/';
  A.__eduFormSave();
  assert.strictEqual(A.getDraft().length, 0);
});

/* ============================ 11) التعديل ============================ */
test('11) تعديل رابط قائم يحدّث نفس العنصر', () => {
  const c = buildCtx({});
  const A = c.API;
  A.setDraft(A.__eduNormalize([{ id: 'noor', name: 'نور', url: 'https://noor.moe.gov.sa/' }]));
  A.setEdit('noor');
  c.dom.eduFName.value = 'نظام نور المطور';
  c.dom.eduFUrl.value = 'https://noor.moe.gov.sa/new';
  c.dom.eduFCat.value = 'systems';
  c.dom.eduFIco.value = '🌟';
  A.__eduFormSave();
  const d = A.getDraft();
  assert.strictEqual(d.length, 1, 'التعديل أضاف عنصرًا بدل تحديثه');
  assert.strictEqual(d[0].id, 'noor');
  assert.strictEqual(d[0].url, 'https://noor.moe.gov.sa/new');
  assert.strictEqual(d[0].name, 'نظام نور المطور');
});

/* ============================ 12) التعطيل ============================ */
test('12) تعطيل رابط يستبعده من الخدمات النشطة', () => {
  const A = buildCtx({}).API;
  A.setDraft(A.__eduNormalize([
    { id: 'a', name: 'أ', url: 'https://a.example.com/' },
    { id: 'b', name: 'ب', url: 'https://b.example.com/' },
  ]));
  A.__eduToggle(0);
  const draft = A.getDraft();
  assert.strictEqual(draft[0].on, false);
  A.setCache(draft);
  const active = A.__eduActive();
  assert.strictEqual(active.length, 1);
  assert.strictEqual(active[0].id, 'b');
});

/* ============================ 13) الحذف ============================ */
test('12ب) الحذف يتطلب تأكيدًا ويقلّل العدد', () => {
  const A = buildCtx({ confirm: true }).API;
  A.setDraft(A.__eduNormalize([
    { id: 'a', name: 'أ', url: 'https://a.example.com/' },
    { id: 'b', name: 'ب', url: 'https://b.example.com/' },
  ]));
  A.__eduDelete(0);
  assert.strictEqual(A.getDraft().length, 1);
  assert.strictEqual(A.getDraft()[0].id, 'b');
});

test('12ب-2) رفض التأكيد لا يحذف', () => {
  const A = buildCtx({ confirm: false }).API;
  A.setDraft(A.__eduNormalize([{ id: 'a', name: 'أ', url: 'https://a.example.com/' }]));
  A.__eduDelete(0);
  assert.strictEqual(A.getDraft().length, 1, 'حُذف دون تأكيد');
});

/* ============================ 13) الترتيب ============================ */
test('13) تبديل الترتيب يعمل', () => {
  const A = buildCtx({}).API;
  A.setDraft(A.__eduNormalize([
    { id: 'a', name: 'أ', url: 'https://a.example.com/', ord: 1 },
    { id: 'b', name: 'ب', url: 'https://b.example.com/', ord: 2 },
  ]));
  A.__eduMove(0, 1);
  const d = A.getDraft();
  assert.strictEqual(d[0].id, 'b');
  assert.strictEqual(d[1].id, 'a');
  assert.ok(d[0].ord < d[1].ord, 'لم يتبدل الترتيب');
});

/* ============================ 14) الاستعادة ============================ */
test('14) استعادة الافتراضي تتطلب تأكيدًا وتعيد العشرة', async () => {
  const c = buildCtx({ confirm: true, online: true, put: async () => true });
  const A = c.API;
  A.setDraft([]);
  A.__eduResetDefaults();
  await new Promise(r => setTimeout(r, 0));
  assert.strictEqual(A.getDraft().length, 10, 'لم تُستعد الافتراضية');
});

test('14ب) رفض تأكيد الاستعادة لا يغيّر شيئًا', () => {
  const A = buildCtx({ confirm: false }).API;
  A.setDraft(A.__eduNormalize([{ id: 'x', name: 'س', url: 'https://x.example.com/' }]));
  A.__eduResetDefaults();
  assert.strictEqual(A.getDraft().length, 1);
});

/* ============================ 15) الحفظ على الخادم ============================ */
test('15) الحفظ يمرّ عبر PUT /api/settings/:school فقط', async () => {
  const calls = [];
  const A = buildCtx({ online: true, put: async (s, d) => { calls.push([s, d]); return true; } }).API;
  const res = await A.__eduSave([{ id: 'a', name: 'أ', url: 'https://a.example.com/' }]);
  assert.strictEqual(res.ok, true);
  assert.ok(calls.length >= 1, 'لم يستدعِ __putSchoolSettings');
  assert.strictEqual(calls[0][0], 'GIRLS');
  assert.ok(Array.isArray(calls[0][1].eduLinks), 'لم تُحفظ eduLinks داخل الإعدادات');
});

test('15ب) فشل الحفظ لا يعلن النجاح', async () => {
  const A = buildCtx({ online: true, put: async () => false }).API;
  const res = await A.__eduSave([{ id: 'a', name: 'أ', url: 'https://a.example.com/' }]);
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, 'save_failed');
});

test('15ج) الحفظ لا يدهس بقية مفاتيح الإعدادات', async () => {
  let got = null;
  const c = buildCtx({ online: true, put: async (s, d) => { if (s === 'GIRLS') got = d; return true; } });
  c.__schoolSettingsCache['GIRLS'] = { academicStart: '2026-01-01', studentMode: true };
  await c.API.__eduSave([{ id: 'a', name: 'أ', url: 'https://a.example.com/' }]);
  assert.strictEqual(got.academicStart, '2026-01-01', 'دُهس مفتاح إعدادات آخر');
  assert.strictEqual(got.studentMode, true);
  assert.ok(Array.isArray(got.eduLinks));
});

test('15ج-2) فشل الحفظ يبقي المسودة', async () => {
  const A = buildCtx({ online: true, put: async () => false }).API;
  A.setDraft(A.__eduNormalize([{ id: 'a', name: 'أ', url: 'https://a.example.com/' }]));
  await A.__eduSaveAll();
  assert.strictEqual(A.getDraft().length, 1, 'أُفرغت المسودة عند الفشل');
});

/* ============================ 16) الإتاحة المشتركة ============================ */
test('16) الحفظ يكتب القائمة للقسمين', async () => {
  const written = [];
  const A = buildCtx({ school: 'GIRLS', online: true, put: async (s) => { written.push(s); return true; } }).API;
  await A.__eduSave([{ id: 'a', name: 'أ', url: 'https://a.example.com/' }]);
  assert.ok(written.includes('GIRLS') && written.includes('BOYS'), 'لم تُكتب للقسمين: ' + written.join(','));
  assert.deepStrictEqual([...A.EDU_LINK_CAMPUSES].sort(), ['BOYS', 'GIRLS']);
});

/* ============================ 17) القراءة من الخادم ============================ */
test('17) القراءة تأخذ من الخادم لا من المتصفح وحده', async () => {
  let reads = 0;
  const c = buildCtx({ online: true, get: async () => { reads++; return { eduLinks: [{ id: 'srv', name: 'من الخادم', url: 'https://srv.example.com/' }] }; } });
  const A = c.API;
  await A.__eduLoad(true);
  assert.ok(reads >= 1, 'لم تُقرأ الإعدادات من الخادم');
  A.setCache(null);
  const list = await A.__eduLoad(true);
  assert.strictEqual(list[0].name, 'من الخادم');
});

test('17ب) الاستمرارية عبر المتصفحات: المرآة المحلية مرآة فقط', () => {
  const store = {};
  const A = buildCtx({ online: true, localStorage: {
    getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; },
  }, get: async () => ({ eduLinks: [{ id: 'srv', name: 'من الخادم', url: 'https://srv.example.com/' }] }), put: async () => true }).API;
  return A.__eduLoad(true).then(list => {
    assert.strictEqual(list[0].name, 'من الخادم');
  });
});

/* ============================ 18) الخادم يفرض الصلاحية ============================ */
test('18) الخادم يفرض دور ADMIN على حفظ الإعدادات', () => {
  const getSeg = sliceBetween(SERVER, "app.get('/api/settings/:school'", "app.put('/api/settings/:school'");
  assert.ok(/requireAuth/.test(getSeg), 'GET بلا مصادقة');
  assert.ok(/schoolAccess\(req\.session, school\)/.test(getSeg), 'GET بلا فحص وصول للقسم');
  const putStart = SERVER.indexOf("app.put('/api/settings/:school'");
  const putSeg = SERVER.slice(putStart, putStart + 700);
  assert.ok(/requireAuth/.test(putSeg), 'PUT بلا مصادقة');
  assert.ok(/schoolAccess\(req\.session, school\)/.test(putSeg), 'PUT بلا فحص وصول للقسم');
  assert.ok(/req\.session\.role !== 'ADMIN'/.test(putSeg), 'PUT لا يفرض دور ADMIN');
  assert.ok(/403/.test(putSeg), 'PUT لا يرد 403');
});

/* ============================ 19) لا مسار/جدول جديد ============================ */
test('19) لا مسار برمجي ولا جدول جديد — إعادة استخدام الإعدادات', () => {
  assert.ok(!/app\.(get|post|put|delete)\(\s*['"]\/api\/edu/.test(SERVER), 'أُضيف مسار جديد');
  assert.ok(!DB.includes('edu_links'), 'أُضيف جدول edu_links');
  assert.ok(/(CREATE TABLE[^;]*app_settings)|app_settings/.test(DB), 'جدول الإعدادات غير مستخدم');
  assert.ok(/__putSchoolSettings\(/.test(extractFn(SRC, '__eduSave')), 'الحفظ لا يستخدم واجهة الإعدادات القائمة');
  assert.ok(/__getSchoolSettings\(/.test(extractFn(SRC, '__eduLoad')), 'القراءة لا تستخدم واجهة الإعدادات القائمة');
  assert.ok(SRC.includes("const SETTINGS_API"), 'واجهة الإعدادات غير معرّفة في العميل');
});

/* ============================ 20) الاتجاه والتصميم ============================ */
test('20) النافذة عربية RTL ومتجاوبة للأحجام الصغيرة والكبيرة', () => {
  assert.ok(SRC.includes('<html lang="ar" dir="rtl">'), 'الصفحة ليست RTL');
  assert.ok(/\.edu-grid\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fill/.test(SRC), 'الشبكة غير متجاوبة تلقائيًا');
  assert.ok(/@media \(max-width:640px\)[\s\S]{0,120}\.edu-grid/.test(SRC), 'لا تجاوب للجوال');
  assert.ok(/@media \(max-width:400px\)\s*\{\s*\.edu-grid/.test(SRC), 'لا تجاوب للشاشات الصغيرة جدًا');
  assert.ok(SRC.includes('.edu-box'), 'لا نمط للنافذة');
});

/* ============================ 21) الإصدارات متسقة ============================ */
test('21) رفع الإصدار وتسجيل عامل الخدمة متسقان (N>=65)', () => {
  const reg = SRC.match(/sw\.js\?v=(\d+)/);
  assert.ok(reg, 'لا تسجيل لعامل الخدمة بمعامل إصدار');
  const cache = SW.match(/CACHE_NAME\s*=\s*'nibras-v(\d+)'/);
  assert.ok(cache, 'لا اسم ذاكرة تخزين مؤقت');
  assert.ok(Number(cache[1]) >= 65, 'إصدار الذاكرة أقل من الحد');
  assert.ok(Number(reg[1]) >= 65, 'إصدار sw.js أقل من الحد');
  const v = SRC.match(/const __APP_VER = '([^']+)'/);
  assert.ok(v && v[1].includes('links-swap'), 'الإصدار لا يحمل وسم تبادل المقعدَين');
});

/* ============================ 22) لا أخطاء JS ============================ */
test('22) الشيفرة تُنفَّذ بلا أخطاء ولا تُخزّن بيانات حساسة', () => {
  assert.doesNotThrow(() => buildCtx({}), 'بناء البيئة يرمي خطأ');
  assert.ok(!/localStorage\.setItem\([^)]*password/i.test(SRC), 'لا تخزين لكلمات المرور');
  assert.ok(!/eduLinks[^\n]*(password|studentId|nationalId|موحد)/i.test(SRC), 'eduLinks يحمل بيانات حساسة');
});

/* ============================ 23) عرض البوابة العامة ============================ */
test('23) __eduBodyHtml يبني الأقسام ويحترم التعطيل', () => {
  const A = buildCtx().API;
  A.setCache(A.__eduDefaultList());
  const html = A.__eduBodyHtml(A.__eduActive());
  assert.ok(html.includes('edu-sec'), 'لا أقسام');
  assert.ok(html.includes('edu-card'), 'لا بطاقات');
  A.setCache(A.__eduNormalize([
    { id: 'a', name: 'أ', url: 'https://a.example.com/', cat: 'systems' },
    { id: 'b', name: 'ب', url: 'https://b.example.com/', cat: 'staff', on: false },
  ]));
  const html2 = A.__eduBodyHtml(A.__eduActive());
  assert.ok(html2.includes('https://a.example.com/'), 'الخدمة النشطة غابت');
  assert.ok(!html2.includes('https://b.example.com/'), 'الخدمة المعطّلة ظهرت');
});

test('23ب) __eduBodyHtml لرسالة لا نتائج', () => {
  const A = buildCtx().API;
  assert.ok(A.__eduBodyHtml([]).includes('لا نتائج'), 'لا رسالة فراغ');
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const HTML_PATH = path.join(ROOT, 'public', 'index.html');
const HTML = fs.readFileSync(HTML_PATH, 'utf8');
const SERVER_SRC = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start !== -1, `الدالة ${name} غير موجودة`);
  const rest = src.slice(start);
  const firstLine = rest.slice(0, rest.indexOf('\n'));
  if (firstLine.includes('}')) return firstLine.trim();
  const m = rest.match(/\r?\n\}(?=\r?\n(?:function |async function |let |const |\/\*|<\/script>|\r?\n))/);
  assert.ok(m, `تعذر استخراج الدالة ${name}`);
  return rest.slice(0, m.index + m[0].length);
}

test('1) بطاقة الخدمات موجودة أسفل الصفحة الرئيسية للجميع دون أي روابط خارجية target="_blank" أو window.open', () => {
  const dashFn = extractFn(HTML, 'renderDashboard');
  const stuDashFn = extractFn(HTML, 'renderStudentDashboard');
  assert.ok(dashFn.includes('${renderUsefulLinksCard()}'), 'renderDashboard لا تتضمن renderUsefulLinksCard');
  assert.ok(stuDashFn.includes('${renderUsefulLinksCard()}'), 'renderStudentDashboard لا تتضمن renderUsefulLinksCard');
  assert.ok(fs.existsSync(path.join(ROOT, 'public', 'school-calendar-1448.pdf')), 'ملف school-calendar-1448.pdf مفقود');
  assert.ok(SERVER_SRC.includes("app.get('/api/translate'") && SERVER_SRC.includes("app.get('/api/prayer'"), 'مسارات الترجمة ومواقيت الصلاة مفقودة من الخادم');
  assert.ok(SERVER_SRC.includes('req.query.tz'), 'مسار مواقيت الصلاة لا يدعم المنطقة الزمنية لموقع المدرسة');
  assert.ok(SERVER_SRC.includes("res.setHeader('X-Frame-Options', 'SAMEORIGIN')"), 'ترويسة X-Frame-Options لا تسمح بعرض ملف التقويم PDF داخليًا (SAMEORIGIN)');
});

test('2) جميع الأيقونات الست تفتح خدمات داخلية في نبراس بلا مغادرة التطبيق', () => {
  const cardFn = extractFn(HTML, 'renderUsefulLinksCard');
  const ctx = {};
  vm.runInNewContext(`${cardFn}\nthis.out = renderUsefulLinksCard();`, ctx);
  const out = ctx.out;
  assert.ok(!out.includes('target="_blank"'), 'لا يجوز وجود target="_blank" في بطاقة الخدمات');
  assert.ok(!out.includes('window.open'), 'لا يجوز وجود window.open في بطاقة الخدمات');
  assert.ok(out.includes('openSchoolCalendar()') && out.includes('🗓️ التقويم الدراسي'), 'أيقونة التقويم الدراسي مفقودة');
  assert.ok(out.includes('openEduLinks()') && out.includes('📚 الروابط التعليمية'), 'أيقونة الروابط التعليمية لا تفتح البوابة الداخلية');
  assert.ok(out.includes('openInAppCalendar()') && out.includes('📅 التقويم'), 'أيقونة التقويم لا تفتح التقويم الداخلي');
  assert.ok(out.includes('openInAppPrayerTimes()') && out.includes('🕌 مواقيت الصلاة'), 'أيقونة مواقيت الصلاة لا تفتح النافذة الداخلية');
  assert.ok(out.includes('openInAppTranslator()') && out.includes('🌐 المترجم'), 'أيقونة المترجم لا تفتح المترجم الداخلي');
  assert.ok(out.includes('openQuickSchedule()') && out.includes('👁 جدول الحصص'), 'أيقونة جدول الحصص مفقودة');

  const eduCardFn = extractFn(HTML, '__eduCardHtml');
  assert.ok(!eduCardFn.includes('target="_blank"'), 'بطاقات بوابة الروابط التعليمية لا تزال تفتح خارج التطبيق');
  assert.ok(eduCardFn.includes('__eduOpenInApp'), 'بطاقات بوابة الروابط التعليمية لا تستخدم __eduOpenInApp');
});

test('3) تشغيل جميع الخدمات الست داخليًا لجميع الأدوار (مديرة، وكيلة، إدارية، معلمة، طالبة)', async () => {
  const idxStart = HTML.indexOf('const __NIBRAS_SC_EVENTS = [');
  const idxEnd = HTML.indexOf('/* ============ «آخر نشاطي»', idxStart);
  assert.ok(idxStart !== -1 && idxEnd !== -1, 'تعذر تحديد كتلة الخدمات الداخلية');
  const servicesBlock = HTML.slice(idxStart, idxEnd);

  const code = [
    'const TIMETABLE_DAYS = [{key:"sun",label:"الأحد"},{key:"mon",label:"الإثنين"},{key:"tue",label:"الثلاثاء"},{key:"wed",label:"الأربعاء"},{key:"thu",label:"الخميس"}];',
    'const TIMETABLE_PERIOD_NAMES = ["الأولى","الثانية","الثالثة","الرابعة","الخامسة","السادسة","السابعة"];',
    'const EDU_CATS = [{id:"systems",icon:"🏛️",name:"الأنظمة التعليمية"}];',
    'function __eduActive(){ return [{id:"moe",cat:"systems",icon:"🧭",name:"وزارة التعليم",url:"https://www.moe.gov.sa/",desc:"الموقع الرسمي"}]; }',
    'function escapeHtml(s){ return String(s==null?"":s).replace(/[&<>"\']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","\'":"&#39;"}[c])); }',
    'function gradeById(id){ return loadDB().grades.find(g => g.id === id); }',
    'function userById(id){ return loadDB().users.find(u => u.id === id); }',
    'function getActiveSchool(){ return "GIRLS"; }',
    servicesBlock,
  ].join('\n');

  let activeUser = null;
  let lastAlert = '';
  const elements = new Map();
  const makeEl = (id) => ({
    id,
    innerHTML: '',
    textContent: '',
    value: '',
    className: '',
    dataset: {},
    remove() { elements.delete(id); },
  });
  const loc = { hash: '#/home' };
  const db = {
    grades: [{ id: 'g1', name: 'الأول المتوسط' }],
    classes: [
      { id: 'c1', gradeId: 'g1', name: 'أ', campus: 'GIRLS' },
      { id: 'c2', gradeId: 'g1', name: 'ب', campus: 'GIRLS' },
    ],
    students: [{ id: 'stu1', name: 'طالبة تجريبية', classId: 'c1' }],
    users: [{ id: 't1', name: 'سارة محمد', role: 'TEACHER' }],
    activities: [{ id: 'a1', title: 'اليوم المفتوح', date: new Date().toISOString().slice(0, 10) }],
    timetable: { t1: { sun: { 1: { classId: 'c1', subject: 'علوم' } } } },
  };
  const storage = new Map();
  let lastModalHtml = '';

  const sandbox = {
    URL,
    Date,
    Intl,
    Math,
    JSON,
    console,
    loadDB: () => db,
    currentUser: () => activeUser,
    location: loc,
    alert: (m) => { lastAlert = String(m); },
    localStorage: {
      getItem: (k) => storage.has(k) ? storage.get(k) : null,
      setItem: (k, v) => storage.set(k, String(v)),
    },
    window: { __tb: {} },
    fetch: async (url) => {
      if (String(url).startsWith('/api/prayer')) {
        const base = Date.now() + 3600000;
        return { ok: true, json: async () => ({ ok: true, tz: 'Asia/Karachi', t: { fajr: base - 7200000, sunrise: base - 3600000, dhuhr: base, asr: base + 10800000, maghrib: base + 21600000, isha: base + 25200000 } }) };
      }
      if (String(url).startsWith('/api/translate')) {
        return { ok: true, json: async () => ({ ok: true, text: 'Welcome to Nibras' }) };
      }
      return { ok: false };
    },
    document: {
      querySelector: () => null,
      getElementById: (id) => elements.get(id) || null,
      createElement: () => ({
        _html: '',
        set innerHTML(v) { this._html = v; },
        get firstElementChild() { return { html: this._html }; },
      }),
      body: {
        appendChild: (el) => {
          lastModalHtml = el.html;
          for (const m of el.html.matchAll(/id="([^"]+)"/g)) {
            if (!elements.has(m[1])) elements.set(m[1], makeEl(m[1]));
          }
        },
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  // 1) التقويم الدراسي: التواريخ الرسمية الكاملة + تصفية الفصلين + تبويب PDF + الإغلاق لجميع الأدوار
  for (const role of ['ADMIN', 'AGENT', 'ADMINISTRATIVE', 'TEACHER', 'STUDENT']) {
    activeUser = { id: 'u_' + role, role };
    sandbox.openSchoolCalendar();
    const allHtml = elements.get('scModalBody').innerHTML;
    assert.ok(allHtml.includes('1448/03/04هـ') && allHtml.includes('2026/08/17م'), 'تاريخ عودة الهيئة الإدارية والمعلمين مفقود');
    assert.ok(allHtml.includes('1448/03/11هـ') && allHtml.includes('2026/08/24م'), 'تاريخ بداية الدراسة للفصل الأول مفقود');
    assert.ok(allHtml.includes('1448/07/26هـ') && allHtml.includes('2027/01/04م'), 'تاريخ بداية اختبارات الفصل الأول مفقود');
    assert.ok(allHtml.includes('1448/08/10هـ') && allHtml.includes('2027/01/18م'), 'تاريخ بداية الفصل الثاني مفقود');
    assert.ok(allHtml.includes('1449/01/19هـ') && allHtml.includes('2027/06/24م'), 'تاريخ نهاية العام الدراسي مفقود');
    sandbox.__scRenderTab('t1');
    assert.ok(elements.get('scModalBody').innerHTML.includes('إجازة اليوم الوطني') && !elements.get('scModalBody').innerHTML.includes('إجازة يوم التأسيس'), 'تصفية الفصل الأول غير دقيقة');
    sandbox.__scRenderTab('t2');
    assert.ok(elements.get('scModalBody').innerHTML.includes('إجازة يوم التأسيس') && !elements.get('scModalBody').innerHTML.includes('إجازة اليوم الوطني'), 'تصفية الفصل الثاني غير دقيقة');
    sandbox.__scRenderTab('pdf');
    assert.ok(elements.get('scModalBody').innerHTML.includes('<iframe src="school-calendar-1448.pdf'), 'التقويم الدراسي لم يعرض PDF داخليًا');
    sandbox.closeSchoolCalendar();
    assert.equal(elements.get('nibrasSchoolCalOverlay'), undefined, `لم تُغلق نافذة التقويم الدراسي للدور ${role}`);
  }

  // 2) بوابة الروابط التعليمية: عرض المصدر داخل نبراس
  elements.set('eduBody', makeEl('eduBody'));
  sandbox.__eduOpenInApp('moe');
  assert.ok(elements.get('eduBody').innerHTML.includes('وزارة التعليم') && elements.get('eduBody').innerHTML.includes('<iframe'), 'بوابة الروابط لم تعرض المصدر داخليًا');

  // 3) التقويم التفاعلي
  sandbox.openInAppCalendar();
  assert.ok(elements.get('nibrasCalBody').innerHTML.includes('اليوم المفتوح'), 'التقويم التفاعلي لم يعرض الفعاليات والأيام');

  // 4) مواقيت الصلاة الداخلية (إسلام آباد)
  sandbox.openInAppPrayerTimes();
  await new Promise(r => setTimeout(r, 10));
  const pHtml = elements.get('nibrasPrayerBody').innerHTML;
  assert.ok(pHtml.includes('إسلام آباد') && pHtml.includes('الفجر') && pHtml.includes('العشاء'), 'مواقيت الصلاة لم تُعرض داخليًا');

  // 5) المترجم الداخلي
  sandbox.openInAppTranslator();
  elements.get('nibrasTrFrom').value = 'ar';
  elements.get('nibrasTrTo').value = 'en';
  elements.get('nibrasTrIn').value = 'مرحبا في نبراس';
  await sandbox.__trRunTranslate();
  assert.equal(elements.get('nibrasTrOut').textContent, 'Welcome to Nibras', 'المترجم الداخلي لم يعرض الترجمة');

  // 6) جدول الحصص لجميع الفئات
  activeUser = { id: 'stu1', role: 'STUDENT' };
  lastModalHtml = '';
  sandbox.openQuickSchedule();
  assert.ok(lastModalHtml.includes('جدول حصص') && lastModalHtml.includes('علوم'), 'جدول الحصص لم يفتح للطالبة');

  activeUser = { id: 't1', role: 'TEACHER' };
  loc.hash = '#/home';
  sandbox.openQuickSchedule();
  assert.equal(loc.hash, '#/timetable', 'المعلمة لم تنتقل إلى #/timetable');

  for (const role of ['ADMIN', 'AGENT', 'SCHOOL_AGENT', 'ADMINISTRATIVE', 'COUNSELOR']) {
    activeUser = { id: 'u_' + role, role };
    lastModalHtml = '';
    lastAlert = '';
    sandbox.openQuickSchedule();
    assert.equal(lastAlert, '', `ظهر تنبيه خطأ للدور ${role}`);
    assert.ok(lastModalHtml.includes('اختر الفصل') && lastModalHtml.includes("viewClassSchedule('c1')"), `نافذة اختيار الفصل لم تظهر للدور ${role}`);
  }
});

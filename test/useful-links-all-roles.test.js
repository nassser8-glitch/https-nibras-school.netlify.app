'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const HTML_PATH = path.join(ROOT, 'public', 'index.html');
const HTML = fs.readFileSync(HTML_PATH, 'utf8');

function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start !== -1, `الدالة ${name} غير موجودة`);
  const rest = src.slice(start);
  const m = rest.match(/\r?\n\}(?=\r?\n(?:function |let |const |\/\*|<\/script>|\r?\n))/);
  assert.ok(m, `تعذر استخراج الدالة ${name}`);
  return rest.slice(0, m.index + m[0].length);
}

test('1) بطاقة الروابط والخدمات موجودة أسفل الصفحة الرئيسية للجميع (renderDashboard و renderStudentDashboard)', () => {
  const dashFn = extractFn(HTML, 'renderDashboard');
  const stuDashFn = extractFn(HTML, 'renderStudentDashboard');
  assert.ok(dashFn.includes('${renderUsefulLinksCard()}'), 'renderDashboard لا تتضمن renderUsefulLinksCard');
  assert.ok(stuDashFn.includes('${renderUsefulLinksCard()}'), 'renderStudentDashboard لا تتضمن renderUsefulLinksCard');
  assert.ok(fs.existsSync(path.join(ROOT, 'public', 'school-calendar-1448.pdf')), 'ملف school-calendar-1448.pdf مفقود');
});

test('2) جميع الأيقونات الست موجودة بالكامل بوظائفها وروابطها في renderUsefulLinksCard', () => {
  const cardFn = extractFn(HTML, 'renderUsefulLinksCard');
  const ctx = {};
  vm.runInNewContext(`${cardFn}\nthis.out = renderUsefulLinksCard();`, ctx);
  const out = ctx.out;
  assert.ok(out.includes('🔗 روابط مفيدة'), 'عنوان روابط مفيدة مفقود');
  assert.ok(out.includes('openSchoolCalendar()') && out.includes('🗓️ التقويم الدراسي'), 'أيقونة التقويم الدراسي مفقودة');
  assert.ok(out.includes('https://www.moe.gov.sa') && out.includes('📚 الروابط التعليمية'), 'أيقونة الروابط التعليمية مفقودة');
  assert.ok(out.includes('calendar.google.com/calendar/embed') && out.includes('📅 التقويم'), 'أيقونة التقويم مفقودة');
  assert.ok(out.includes('islamicfinder.org/prayer-widget') && out.includes('🕌 مواقيت الصلاة'), 'أيقونة مواقيت الصلاة مفقودة');
  assert.ok(out.includes('bing.com/translator') && out.includes('🌐 المترجم'), 'أيقونة المترجم مفقودة');
  assert.ok(out.includes('openQuickSchedule()') && out.includes('👁 جدول الحصص'), 'أيقونة جدول الحصص مفقودة');
});

test('3) عمل الخدمات وجدول الحصص لجميع الأدوار (المديرة، الوكيلة، الإدارية، المعلمة، الطالبة)', () => {
  const code = [
    'const TIMETABLE_DAYS = [{key:"sun",label:"الأحد"},{key:"mon",label:"الإثنين"},{key:"tue",label:"الثلاثاء"},{key:"wed",label:"الأربعاء"},{key:"thu",label:"الخميس"}];',
    'const TIMETABLE_PERIOD_NAMES = ["الأولى","الثانية","الثالثة","الرابعة","الخامسة","السادسة","السابعة"];',
    'let __lastClassScheduleHTML = "";',
    'function escapeHtml(s){ return String(s==null?"":s).replace(/[&<>"\']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","\'":"&#39;"}[c])); }',
    'function gradeById(id){ return loadDB().grades.find(g => g.id === id); }',
    'function userById(id){ return loadDB().users.find(u => u.id === id); }',
    'function getActiveSchool(){ return "GIRLS"; }',
    extractFn(HTML, 'openEmbeddedViewer'),
    extractFn(HTML, 'closeEmbeddedViewer'),
    extractFn(HTML, 'openSchoolCalendar'),
    extractFn(HTML, 'closeSchoolCalendar'),
    extractFn(HTML, 'viewClassSchedule'),
    extractFn(HTML, 'closeClassSchedule'),
    extractFn(HTML, 'openQuickSchedule'),
  ].join('\n');

  let activeUser = null;
  let lastModalHtml = '';
  let lastAlert = '';
  const loc = { hash: '#/home' };
  const db = {
    grades: [{ id: 'g1', name: 'الأول المتوسط' }],
    classes: [
      { id: 'c1', gradeId: 'g1', name: 'أ', campus: 'GIRLS' },
      { id: 'c2', gradeId: 'g1', name: 'ب', campus: 'GIRLS' },
    ],
    students: [{ id: 'stu1', name: 'طالبة تجريبية', classId: 'c1' }],
    users: [{ id: 't1', name: 'سارة محمد', role: 'TEACHER' }],
    timetable: { t1: { sun: { 1: { classId: 'c1', subject: 'علوم' } } } },
  };

  const sandbox = {
    loadDB: () => db,
    currentUser: () => activeUser,
    location: loc,
    alert: (m) => { lastAlert = String(m); },
    document: {
      querySelector: () => null,
      createElement: () => ({
        _html: '',
        set innerHTML(v) { this._html = v; },
        get firstElementChild() { return { html: this._html }; },
      }),
      body: {
        appendChild: (el) => { lastModalHtml = el.html; },
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  // التقويم الدراسي
  sandbox.openSchoolCalendar();
  assert.ok(lastModalHtml.includes('school-calendar-1448.pdf'), 'التقويم الدراسي لم يفتح الملف');

  // مواقيت الصلاة + المترجم + التقويم
  sandbox.openEmbeddedViewer('🕌 مواقيت الصلاة', 'https://www.islamicfinder.org/prayer-widget/');
  assert.ok(lastModalHtml.includes('islamicfinder.org/prayer-widget'), 'مواقيت الصلاة لم تُفتح');
  sandbox.openEmbeddedViewer('🌐 المترجم', 'https://www.bing.com/translator');
  assert.ok(lastModalHtml.includes('bing.com/translator'), 'المترجم لم يُفتح');

  // الطالبة: تفتح جدول فصلها مباشرة
  activeUser = { id: 'stu1', role: 'STUDENT' };
  lastModalHtml = '';
  sandbox.openQuickSchedule();
  assert.ok(lastModalHtml.includes('جدول حصص') && lastModalHtml.includes('علوم'), 'جدول الحصص لم يفتح للطالبة');

  // المعلمة: تنتقل لصفحة جدول الحصص
  activeUser = { id: 't1', role: 'TEACHER' };
  loc.hash = '#/home';
  sandbox.openQuickSchedule();
  assert.equal(loc.hash, '#/timetable', 'المعلمة لم تنتقل إلى #/timetable');

  // المديرة والوكيلة والإدارية: تفتح نافذة اختيار الفصل ثم عرض الجدول
  for (const role of ['ADMIN', 'AGENT', 'SCHOOL_AGENT', 'ADMINISTRATIVE', 'COUNSELOR']) {
    activeUser = { id: 'u_' + role, role };
    lastModalHtml = '';
    lastAlert = '';
    sandbox.openQuickSchedule();
    assert.equal(lastAlert, '', `ظهر تنبيه خطأ للدور ${role}`);
    assert.ok(lastModalHtml.includes('اختر الفصل') && lastModalHtml.includes("viewClassSchedule('c1')"), `نافذة اختيار الفصل لم تظهر للدور ${role}`);
  }
});

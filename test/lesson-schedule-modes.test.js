'use strict';
/* =============================================================================
 * اختبارات تطوير إعدادات أوقات الحصص (الدوام الشتوي والصيفي) والعداد الذكي — قسم البنات
 * ========================================================================== */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const SW = fs.readFileSync(path.join(ROOT, 'public', 'sw.js'), 'utf8');

function sliceBetween(src, start, end){
  const i = src.indexOf(start);
  assert.ok(i >= 0, 'لم يُعثر على: ' + start);
  const j = end ? src.indexOf(end, i + start.length) : src.length;
  assert.ok(j >= 0, 'لم يُعثر على نهاية: ' + end);
  return src.slice(i, j);
}

const CORE = sliceBetween(HTML, '/* ===== LESSON-COUNTER-START', '/* ===== LESSON-COUNTER-END');
const api = new Function(
  'const escapeHtml = (s) => String(s == null ? "" : s);\n' + CORE +
  '\nreturn { lessonHmToMin, lessonMinToHm, lessonDefaultTimes, lessonNormalizeTimes, lessonResolveSettings, lessonFmtDur, lessonComputeState, lessonCardBody, LESSON_DOW_KEY, LESSON_RECESS_AFTER, LESSON_WINTER_DEFAULT_TIMES };'
)();

// 26 أكتوبر 2026 = الاثنين (dow = 1)
function at(h, m, s){
  return new Date(2026, 9, 26, h, m, s || 0, 0).getTime();
}

const ALL7 = {};
for(let p = 1; p <= 7; p++) ALL7[String(p)] = { subjectLabel:'مادة ' + p, className:'فصل ' + p };

test('1-4) التوقيت الشتوي: 7 حصص تبدأ 08:00 ص، الفسحة 10:15 - 10:30، ونهاية اليوم 13:30', () => {
  const w = api.lessonDefaultTimes('winter');
  assert.strictEqual(w.periods.length, 7);
  const hm = w.periods.map(p => api.lessonMinToHm(p.start) + '-' + api.lessonMinToHm(p.end));
  assert.deepStrictEqual(hm, [
    '08:00-08:45',
    '08:45-09:30',
    '09:30-10:15',
    '10:30-11:15',
    '11:15-12:00',
    '12:00-12:45',
    '12:45-13:30',
  ]);
  assert.strictEqual(api.lessonMinToHm(w.periods[0].start), '08:00');
  assert.strictEqual(api.lessonMinToHm(w.periods[2].end), '10:15');
  assert.strictEqual(api.lessonMinToHm(w.periods[3].start), '10:30');
});

test('5) العداد الذكي في الدوام الشتوي: قبل 08:00، عرض وقت البداية والنهاية، الفسحة 10:15، الحصة الرابعة 10:30، وبعد 13:30', () => {
  const w = api.lessonDefaultTimes('winter');
  const snap = {
    dow: 1,
    times: w.periods,
    days: w.days,
    lessons: ALL7,
    periodNames: ['الأولى','الثانية','الثالثة','الرابعة','الخامسة','السادسة','السابعة'],
    present: true,
  };

  // قبل بداية الدوام (07:45)
  const before = api.lessonComputeState(snap, at(7, 45));
  assert.strictEqual(before.kind, 'before');
  assert.strictEqual(before.period, 1);
  assert.strictEqual(before.remainMs, 15 * 60000);

  // أثناء الحصة الأولى (08:10) — يعرض البداية والنهاية (08:00 - 08:45)
  const during1 = api.lessonComputeState(snap, at(8, 10));
  assert.strictEqual(during1.kind, 'during');
  assert.strictEqual(during1.period, 1);
  const card1 = api.lessonCardBody(during1, snap);
  assert.ok(card1.includes('08:00 - 08:45'), 'يعرض وقت بداية الحصة ونهايتها');

  // الساعة 10:15 تماماً: ينتقل تلقائياً من الثالثة إلى الفسحة (استراحة)
  const recess = api.lessonComputeState(snap, at(10, 15));
  assert.strictEqual(recess.kind, 'break');
  assert.strictEqual(recess.recess, true);
  assert.strictEqual(recess.period, 4);
  assert.strictEqual(recess.remainMs, 15 * 60000);
  const recessHtml = api.lessonCardBody(recess, snap);
  assert.ok(recessHtml.includes('وقت الفسحة'));
  assert.ok(recessHtml.includes('الحصة الرابعة تبدأ بعد 15:00'));
  assert.ok(!recessHtml.includes('داخل الحصة'));

  // الساعة 10:30 تماماً: ينتقل تلقائياً إلى الحصة الرابعة
  const during4 = api.lessonComputeState(snap, at(10, 30));
  assert.strictEqual(during4.kind, 'during');
  assert.strictEqual(during4.period, 4);
  const card4 = api.lessonCardBody(during4, snap);
  assert.ok(card4.includes('10:30 - 11:15'));

  // بعد نهاية الحصة السابعة (13:30)
  const done = api.lessonComputeState(snap, at(13, 30));
  assert.strictEqual(done.kind, 'done');
});

test('6) استقلال الدوام الصيفي عن الشتوي والاحتفاظ بالأوقات الصيفية الموجودة', () => {
  const customSummer = {
    periods: [
      { start:'07:15', end:'08:00' },
      { start:'08:00', end:'08:45' },
      { start:'08:45', end:'09:30' },
      { start:'09:45', end:'10:30' },
      { start:'10:30', end:'11:15' },
      { start:'11:15', end:'12:00' },
      { start:'12:00', end:'12:45' },
    ],
    days: [1,2,3,4,5],
  };

  // أوقات صيفية قائمة مسبقاً قبل وجود scheduleMode تُحفظ تلقائياً كصيفي
  const r1 = api.lessonResolveSettings({ scheduleTimes: customSummer });
  assert.strictEqual(r1.mode, 'summer');
  assert.strictEqual(api.lessonMinToHm(r1.active.periods[0].start), '07:15');
  assert.strictEqual(api.lessonMinToHm(r1.winter.periods[0].start), '08:00');

  // التبديل إلى الشتوي لا يمسّ الأوقات الصيفية المحفوظة
  const r2 = api.lessonResolveSettings({
    scheduleMode: 'winter',
    scheduleTimesSummer: customSummer,
    scheduleTimesWinter: api.LESSON_WINTER_DEFAULT_TIMES,
  });
  assert.strictEqual(r2.mode, 'winter');
  assert.strictEqual(api.lessonMinToHm(r2.active.periods[0].start), '08:00');
  assert.strictEqual(api.lessonMinToHm(r2.summer.periods[0].start), '07:15');

  // العودة إلى الصيفي تستعيد الأوقات الصيفية المستقلة
  const r3 = api.lessonResolveSettings({
    scheduleMode: 'summer',
    scheduleTimesSummer: customSummer,
    scheduleTimesWinter: api.LESSON_WINTER_DEFAULT_TIMES,
  });
  assert.strictEqual(r3.mode, 'summer');
  assert.strictEqual(api.lessonMinToHm(r3.active.periods[0].start), '07:15');
});

test('7) صلاحيات العرض والتعديل: المدير يعدّل، وبقية المستخدمين يشاهدون الأوقات المعتمدة فقط', () => {
  const fnBlock = sliceBetween(HTML, 'function lessonSettingsCard(){', 'async function switchLessonMode(');
  const tailBlock = sliceBetween(HTML, 'function lessonScheduleState(){', 'function lessonSerializeTimes(')
    + sliceBetween(HTML, 'function lessonSerializeTimes(', 'function lessonSnapshotFor(');

  function renderForRole(role){
    const ctx = {
      currentUser: () => ({ id: 'u1', name: 'مستخدم', role }),
      getActiveSchool: () => 'GIRLS',
      __schoolSettingsCache: { GIRLS: { scheduleMode: 'winter', scheduleTimesWinter: api.LESSON_WINTER_DEFAULT_TIMES } },
      TIMETABLE_PERIOD_NAMES: ['الأولى','الثانية','الثالثة','الرابعة','الخامسة','السادسة','السابعة'],
      LESSON_RECESS_AFTER: 3,
      lessonMinToHm: api.lessonMinToHm,
      lessonResolveSettings: api.lessonResolveSettings,
    };
    vm.createContext(ctx);
    vm.runInContext(tailBlock + '\n' + fnBlock, ctx);
    return ctx.lessonSettingsCard();
  }

  const adminHtml = renderForRole('ADMIN');
  assert.ok(adminHtml.includes('switchLessonMode(\'winter\')'), 'المدير يملك أزرار التبديل');
  assert.ok(adminHtml.includes('saveLessonTimes()'), 'المدير يملك زر الحفظ');
  assert.ok(adminHtml.includes('resetLessonTimes()'), 'المدير يملك زر الاستعادة');
  assert.ok(adminHtml.includes('type="time"'), 'المدير يملك حقول تعديل الوقت');

  for (const role of ['TEACHER', 'AGENT', 'COUNSELOR', 'ADMINISTRATIVE']) {
    const viewHtml = renderForRole(role);
    assert.ok(viewHtml.includes('أوقات الحصص'), `العنوان يظهر لدور ${role}`);
    assert.ok(viewHtml.includes('الدوام الشتوي'), `نوع الدوام يظهر لدور ${role}`);
    assert.ok(viewHtml.includes('08:00 - 08:45'), `أوقات الحصص المعتمدة تظهر لدور ${role}`);
    assert.ok(viewHtml.includes('10:15 - 10:30'), `الفسحة تظهر لدور ${role}`);
    assert.ok(!viewHtml.includes('switchLessonMode('), `لا أزرار تبديل لدور ${role}`);
    assert.ok(!viewHtml.includes('saveLessonTimes('), `لا زر حفظ لدور ${role}`);
    assert.ok(!viewHtml.includes('type="time"'), `لا حقول تعديل لدور ${role}`);
  }

  // حماية الخادم: غير المدير لا يستطيع تعديل مفاتيح الجدول عبر PUT /api/settings/:school
  assert.ok(SERVER.includes('admin_only_schedule'), 'الخادم يحمي مفاتيح أوقات الحصص للمدير فقط');
});

test('8-11) استمرار الإعدادات بعد الخروج/الدخول، عدم مساس الجداول الأسبوعية، وهوية قسم البنات وSW', () => {
  const logoutFn = sliceBetween(HTML, 'function logout(){', 'const user = currentUser();');
  assert.ok(logoutFn.includes('__schoolSettingsCache'), 'logout يمسح ذاكرة إعدادات القسم لإعادة الجلب عند الدخول');
  assert.ok(HTML.includes('async function __getSchoolSettings(school, force)'), '__getSchoolSettings يدعم التحديث القسري');

  // الهوية البصرية لقسم البنات (#fdf2f8 / #fbcfe8 / #831843)
  const settingsCardFn = sliceBetween(HTML, 'function lessonSettingsCard(){', 'async function switchLessonMode(');
  assert.ok(settingsCardFn.includes('#fdf2f8') && settingsCardFn.includes('#fbcfe8'), 'الهوية الوردية لقسم البنات محفوظة');

  // الجداول الأسبوعية لا تتأثر
  assert.ok(!settingsCardFn.includes('timetable['), 'محرر الأوقات لا يلمس timetable');

  // تطابق إصدار SW
  const swMatch = SW.match(/const CACHE_NAME = 'nibras-v(\d+)'/);
  const regMatch = HTML.match(/register\('sw\.js\?v=(\d+)'/);
  assert.ok(swMatch && regMatch && swMatch[1] === regMatch[1] && Number(swMatch[1]) >= 179);
});

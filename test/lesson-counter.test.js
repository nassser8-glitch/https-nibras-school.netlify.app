/* العداد الذكي لحصص المعلمين — اختبارات بالجدول الرسمي (البنات):
 * 7 حصص × 45 دقيقة، من 7:30 ص إلى 1:00 ظ، والفسحة 9:45 – 10:00 بعد الحصة الثالثة.
 * المصدر الوحيد للجدول: timetable[teacherId][DAY][period] = { subject, classId }.
 * هذه الاختبارات تستخرج كتلة LESSON-COUNTER من index.html وتشغّل دوالها النقية.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

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
  '\nreturn { lessonHmToMin, lessonMinToHm, lessonDefaultTimes, lessonNormalizeTimes, lessonFmtDur, lessonComputeState, lessonCardBody, LESSON_DOW_KEY, LESSON_RECESS_AFTER };'
)();

// 26 أكتوبر 2026 = الاثنين (dow = 1)
function at(h, m, s){
  return new Date(2026, 9, 26, h, m, s || 0, 0).getTime();
}
function snap(lessons, opts){
  const d = api.lessonDefaultTimes();
  return Object.assign({
    dow: 1,
    times: d.periods,
    days: d.days,
    lessons: lessons || {},
    periodNames: ['الأولى','الثانية','الثالثة','الرابعة','الخامسة','السادسة','السابعة'],
    present: false
  }, opts || {});
}
const LESSONS = {
  '1': { subjectLabel:'رياضيات', className:'الأول المتوسط - أ' },
  '2': { subjectLabel:'علوم', className:'الثاني المتوسط - ب' },
  '4': { subjectLabel:'لغة عربية', className:'الثالث المتوسط - ج' }
};
const ALL7 = {};
for(let p = 1; p <= 7; p++) ALL7[String(p)] = { subjectLabel:'مادة ' + p, className:'فصل ' + p };

test('الجدول الرسمي: 7 حصص من 7:30 إلى 1:00 ظ، والفسحة 9:45–10:00', () => {
  const d = api.lessonDefaultTimes();
  assert.strictEqual(d.periods.length, 7);
  assert.deepStrictEqual(d.days, [1,2,3,4,5]);
  const hm = d.periods.map(p => api.lessonMinToHm(p.start) + '-' + api.lessonMinToHm(p.end));
  assert.deepStrictEqual(hm, ['07:30-08:15','08:15-09:00','09:00-09:45','10:00-10:45','10:45-11:30','11:30-12:15','12:15-13:00']);
  assert.strictEqual(api.LESSON_RECESS_AFTER, 3);
});

test('1) قبل بداية الحصة الأولى: «الحصة القادمة» مع عدّاد تنازلي ووقت البداية', () => {
  const st = api.lessonComputeState(snap(LESSONS), at(6, 50));
  assert.strictEqual(st.kind, 'before');
  assert.strictEqual(st.period, 1);
  assert.strictEqual(st.remainMs, 40 * 60000);
  assert.strictEqual(st.tone, 'blue');
  const html = api.lessonCardBody(st, snap(LESSONS));
  assert.match(html, /الحصة القادمة/);
  assert.match(html, /تبدأ بعد 40:00/);
  assert.match(html, /يبدأ 07:30/);
  assert.match(html, /الحصة الأولى/);
});

test('2) بداية الحصة الأولى 7:30 بالضبط: تتحول إلى «جارية حسب الجدول»', () => {
  assert.strictEqual(api.lessonComputeState(snap(LESSONS), at(7, 29, 59)).kind, 'before');
  const st = api.lessonComputeState(snap(LESSONS), at(7, 30, 0));
  assert.strictEqual(st.kind, 'during');
  assert.strictEqual(st.period, 1);
  assert.strictEqual(Math.round(st.progress), 0);
});

test('3) منتصف الحصة 7:52:30: وقت متبقٍ بالثواني وشريط تقدم 50%', () => {
  const st = api.lessonComputeState(snap(LESSONS), at(7, 52, 30));
  assert.strictEqual(st.kind, 'during');
  assert.strictEqual(st.progress, 50);
  assert.strictEqual(st.remainMs, 22.5 * 60000);
  const html = api.lessonCardBody(st, snap(LESSONS, { present: true }));
  assert.match(html, /المعلمة داخل الحصة الآن/);
  assert.match(html, /متبقٍ على نهاية الحصة: 22:30/);
  assert.match(html, /width:50%/);
  assert.match(html, /07:30 — 08:15|الحصة الأولى/);
});

test('3ب) أثناء الحصة دون تأكيد تواجد: «جارية حسب الجدول» فقط', () => {
  const st = api.lessonComputeState(snap(LESSONS), at(7, 40));
  const html = api.lessonCardBody(st, snap(LESSONS, { present: false }));
  assert.match(html, /الحصة جارية حسب الجدول/);
  assert.doesNotMatch(html, /داخل الحصة الآن/);
});

test('4) نهاية الحصة بعد 45 دقيقة: 8:15 تبدأ الثانية مباشرة', () => {
  assert.strictEqual(api.lessonComputeState(snap(ALL7), at(8, 14, 59)).period, 1);
  const st = api.lessonComputeState(snap(ALL7), at(8, 15, 0));
  assert.strictEqual(st.kind, 'during');
  assert.strictEqual(st.period, 2);
});

test('5) الفسحة 9:45–10:00: «وقت الفسحة» والعد للحصة الرابعة، وليست حصة', () => {
  const st = api.lessonComputeState(snap(ALL7), at(9, 45, 0));
  assert.strictEqual(st.kind, 'break');
  assert.strictEqual(st.recess, true);
  assert.strictEqual(st.period, 4);
  assert.strictEqual(st.remainMs, 15 * 60000);
  const html = api.lessonCardBody(st, snap(LESSONS));
  assert.match(html, /وقت الفسحة/);
  assert.match(html, /الحصة الرابعة تبدأ بعد 15:00/);
  assert.doesNotMatch(html, /داخل الحصة/);
});

test('5ب) انتهاء الفسحة 10:00: الحصة الرابعة تبدأ تلقائيًا', () => {
  assert.strictEqual(api.lessonComputeState(snap(ALL7), at(9, 59, 59)).recess, true);
  const st = api.lessonComputeState(snap(ALL7), at(10, 0, 0));
  assert.strictEqual(st.kind, 'during');
  assert.strictEqual(st.period, 4);
});

test('5ج) الفسحة قبل الحصة الرابعة بأقل من 5 دقائق: برتقالي', () => {
  assert.strictEqual(api.lessonComputeState(snap(ALL7), at(9, 56)).tone, 'orange');
});

test('6) نهاية الحصة السابعة 1:00 ظ: «انتهت حصص اليوم» وإيقاف العد', () => {
  const st = api.lessonComputeState(snap(ALL7), at(12, 59, 59));
  assert.strictEqual(st.kind, 'during');
  assert.strictEqual(st.period, 7);
  const end = api.lessonComputeState(snap(ALL7), at(13, 0, 0));
  assert.strictEqual(end.kind, 'done');
  assert.match(api.lessonCardBody(end, snap(ALL7)), /انتهت حصص اليوم/);
});

test('7) غياب الجدول: «لا يوجد جدول متاح»، والحصة المحذوفة لا تُحسب', () => {
  const st = api.lessonComputeState(snap({}), at(8, 0));
  assert.strictEqual(st.kind, 'noschedule');
  assert.match(api.lessonCardBody(st, snap({})), /لا يوجد جدول متاح/);
  const del = api.lessonComputeState(snap({ '1': { _del:true, subjectLabel:'رياضيات', className:'x' } }), at(8, 0));
  assert.strictEqual(del.kind, 'noschedule');
});

test('7ب) السبت/الأحد: «لا دوام اليوم»', () => {
  const st = api.lessonComputeState(snap(LESSONS, { dow: 6 }), at(8, 0));
  assert.strictEqual(st.kind, 'offday');
  assert.match(api.lessonCardBody(st, snap(LESSONS, { dow: 6 })), /لا دوام اليوم/);
});

test('لا حصص وهمية: المعلم الذي لديه حصة ثالثة فقط لا يظهر حصة الأولى', () => {
  const only = { '3': { subjectLabel:'حاسب', className:'أول ثانوي - أ' } };
  const st = api.lessonComputeState(snap(only), at(7, 40));
  assert.strictEqual(st.kind, 'before');
  assert.strictEqual(st.period, 3);
  assert.strictEqual(st.remainMs, 80 * 60000);     // 7:40 → 9:00
});

test('فسحة لمعلم بلا حصة بعدها: «لا حصة لك الآن» وليست فسحة', () => {
  const only = { '2': { subjectLabel:'علوم', className:'x' }, '4': { subjectLabel:'عربي', className:'y' } };
  const st = api.lessonComputeState(snap(only), at(9, 50));
  assert.strictEqual(st.kind, 'break');
  assert.strictEqual(st.recess, false);           // لا حصة له في الثالثة: لا تُعرض كفسحة
  const gap = api.lessonComputeState(snap({ '1': LESSONS['1'], '4': LESSONS['4'] }), at(8, 30));
  assert.strictEqual(gap.kind, 'break');
  assert.strictEqual(gap.recess, false);
  assert.match(api.lessonCardBody(gap, snap({})), /لا حصة الآن/);
});

test('تنسيق المدة وتطبيع الأوقات', () => {
  assert.strictEqual(api.lessonFmtDur(65000), '01:05');
  assert.strictEqual(api.lessonFmtDur(3725000), '1:02:05');
  const ok = api.lessonNormalizeTimes({ periods:[{start:'07:30', end:'08:15'}, {start:'08:15', end:'09:00'}], days:[1,2,3,4,5] });
  assert.deepStrictEqual(ok.periods[0], { start:450, end:495 });
  assert.strictEqual(api.lessonNormalizeTimes({ periods:[{start:'08:00', end:'07:00'}] }), null);
  assert.strictEqual(api.lessonNormalizeTimes({ periods:[{start:'07:00', end:'08:00'}, {start:'07:30', end:'09:00'}] }), null);
  assert.strictEqual(api.lessonNormalizeTimes(null), null);
});

test('البنية: تحديث كل ثانية للبطاقات، ووقت الخادم، ومحرر الأوقات مع الفسحة', () => {
  assert.match(HTML, /setInterval\(lessonTick, 1000\)/);
  assert.match(HTML, /data-lesson-key/);
  assert.ok(HTML.split('lessonCard(').length - 1 >= 2);
  assert.match(HTML, /function saveLessonTimes\(/);
  assert.match(HTML, /الفسحة: /, 'الفسحة ظاهرة في محرر الأوقات');
  assert.match(SERVER, /app\.get\('\/api\/auth\/time'/);
});

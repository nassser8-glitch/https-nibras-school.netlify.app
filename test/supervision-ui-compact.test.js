'use strict';
/* =============================================================================
 * اختبارات واجهة الإشراف اليومي المختصرة — قسم البنات (الهوية الوردية)
 * ========================================================================== */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const SW = fs.readFileSync(path.join(ROOT, 'public', 'sw.js'), 'utf8');

function sliceBetween(src, start, end){
  const i = src.indexOf(start);
  assert.ok(i >= 0, 'لم يُعثر على: ' + start);
  const j = end ? src.indexOf(end, i + start.length) : src.length;
  assert.ok(j >= 0, 'لم يُعثر على نهاية: ' + end);
  return src.slice(i, j);
}

test('1) واجهة الإشراف اليومي: ملخص 4 بطاقات، مشرفات اليوم، جدول أسبوعي مضغوط، وبطاقات جوال قابلة للطي', () => {
  const fn = sliceBetween(HTML, 'function renderSupervisionAdmin(){', '/* ===== جدول الإشراف اليومي الأسبوعي');
  const draft = {
    1: new Set(['t1', 't2']),
    2: new Set(['t1']),
    3: new Set([]),
    4: new Set(['t2']),
    5: new Set([]),
  };
  const ctx = {
    __supervisionSchedule: { schedule: [{ dayOfWeek: 1, teacherId: 't1', name: 'أروى' }, { dayOfWeek: 1, teacherId: 't2', name: 'تهاني' }] },
    __supervisionToday: {
      dayOfWeek: 1,
      assigned: [
        { teacherId: 't1', name: 'أروى بشير', checkedInAt: '08:05' },
        { teacherId: 't2', name: 'تهاني أحمد', checkedInAt: null },
      ],
    },
    __supervisionDraftSchedule: draft,
    __supervisionAddOpenDay: 1,
    __supervisionPickerSelected: {},
    __ensureSupervisionDraft: () => {},
    __isSupervisionDraftDirty: () => false,
    currentUser: () => ({ id: 'a1', role: 'ADMIN' }),
    loadDB: () => ({
      users: [
        { id: 't1', role: 'TEACHER', active: true, name: 'أروى بشير' },
        { id: 't2', role: 'TEACHER', active: true, name: 'تهاني أحمد' },
        { id: 't3', role: 'TEACHER', active: true, name: 'نهلة فتحي' },
      ],
    }),
    SUPERVISION_DAYS: [
      { key: 'MONDAY', label: 'الاثنين', dow: 1 },
      { key: 'TUESDAY', label: 'الثلاثاء', dow: 2 },
      { key: 'WEDNESDAY', label: 'الأربعاء', dow: 3 },
      { key: 'THURSDAY', label: 'الخميس', dow: 4 },
      { key: 'FRIDAY', label: 'الجمعة', dow: 5 },
    ],
    escapeHtml: s => String(s == null ? '' : s),
  };
  vm.createContext(ctx);
  vm.runInContext(fn, ctx);

  const out = ctx.renderSupervisionAdmin();
  assert.ok(out.includes('class="sup-stats"'), 'شريط الإحصائيات موجود');
  assert.ok(out.includes('مشرفات اليوم') && out.includes('المعلمات المكلفات') && out.includes('سجلن المباشرة') && out.includes('لم يسجلن الحضور'));
  assert.ok(out.includes('08:05'), 'وقت تسجيل الحضور ظاهر');
  assert.ok(out.includes('class="sup-days-grid"'), 'شبكة بطاقات الأيام (3 في كل صف) موجودة');
  assert.ok(out.includes('sup-day-today'), 'تمييز اليوم الحالي موجود');
  assert.ok(out.includes('sup-day-card'), 'بطاقات الأيام متساوية الارتفاع موجودة');
  assert.ok(out.includes('data-supervision-picker="1"'), 'منتقي إضافة المشرفات يعمل');
  assert.ok(out.includes('__saveSupervisionSchedule()'), 'زر حفظ الجدول موجود');
  assert.ok(out.includes('__recordSupervision(\'t2\',true)'), 'زر تسجيل المباشرة موجود');
});

test('2) الهوية الوردية لقسم البنات وتطابق Service Worker', () => {
  assert.ok(HTML.includes('.sup-header {') && HTML.includes('#db2777'));
  assert.ok(HTML.includes('.sup-days-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr));'));
  const cacheM = SW.match(/const CACHE_NAME = 'nibras-v(\d+)'/);
  const regM = HTML.match(/register\('sw\.js\?v=(\d+)'/);
  assert.ok(cacheM && regM && cacheM[1] === regM[1] && Number(cacheM[1]) >= 181);
});

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const INDEX_HTML_PATH = path.join(__dirname, '..', 'public', 'index.html');

function extractFunctionSource(src, marker) {
  const startIdx = src.indexOf(marker);
  if (startIdx === -1) throw new Error(`function not found in index.html: ${marker}`);
  const braceStart = src.indexOf('{', startIdx);
  let depth = 0;
  let end = braceStart;
  for (; end < src.length; end++) {
    if (src[end] === '{') depth++;
    else if (src[end] === '}') {
      depth--;
      if (depth === 0) { end++; break; }
    }
  }
  return src.slice(startIdx, end);
}

function extractArrayLiteral(src, marker) {
  const startIdx = src.indexOf(marker);
  if (startIdx === -1) throw new Error(`array not found in index.html: ${marker}`);
  const bracketStart = src.indexOf('[', startIdx);
  let depth = 0;
  let end = bracketStart;
  for (; end < src.length; end++) {
    if (src[end] === '[') depth++;
    else if (src[end] === ']') {
      depth--;
      if (depth === 0) { end++; break; }
    }
  }
  return src.slice(bracketStart, end);
}

function buildSandbox({ initialStorage = {}, fetchImpl } = {}) {
  const src = fs.readFileSync(INDEX_HTML_PATH, 'utf8');

  const supervisionDaysSrc = extractArrayLiteral(src, 'const SUPERVISION_DAYS = [');
  const getDraftKeySrc = extractFunctionSource(src, 'function __getSupervisionDraftStorageKey(){');
  const persistDraftSrc = extractFunctionSource(src, 'function __persistSupervisionDraft(){');
  const clearDraftSrc = extractFunctionSource(src, 'function __clearSupervisionDraftStorage(){');
  const loadPersistedDraftSrc = extractFunctionSource(src, 'function __loadPersistedSupervisionDraft(){');
  const isDirtySrc = extractFunctionSource(src, 'function __isSupervisionDraftDirty(){');
  const togglePickerSelectSrc = extractFunctionSource(src, 'function __supervisionTogglePickerSelect(dow, teacherId, isChecked){');
  const ensureDraftSrc = extractFunctionSource(src, 'function __ensureSupervisionDraft(){');
  const togglePickerSrc = extractFunctionSource(src, 'function __supervisionToggleAddPicker(dow){');
  const addSelectedSrc = extractFunctionSource(src, 'function __supervisionAddSelected(dow){');
  const removeTeacherSrc = extractFunctionSource(src, 'function __supervisionRemoveTeacher(dow, teacherId){');
  const saveScheduleSrc = extractFunctionSource(src, 'async function __saveSupervisionSchedule(){');

  const storageMap = new Map(Object.entries(initialStorage));
  const fakeLocalStorage = {
    getItem(key) { return storageMap.has(key) ? storageMap.get(key) : null; },
    setItem(key, val) { storageMap.set(key, String(val)); },
    removeItem(key) { storageMap.delete(key); },
    clear() { storageMap.clear(); },
  };

  const fakeDocument = {
    querySelectorAll(selector) {
      return [];
    },
  };

  const context = {
    __supervisionSchedule: null,
    __supervisionDraftSchedule: null,
    __supervisionAddOpenDay: null,
    __supervisionPickerSelected: {},
    SUPERVISION_DRAFT_KEY_PREFIX: 'nibras_supervision_draft_v1_',
    renderAppCallCount: 0,
    renderApp: null,
    localStorage: fakeLocalStorage,
    document: fakeDocument,
    currentUser: () => ({ role: 'ADMIN' }),
    getActiveSchool: () => 'GIRLS',
    SUPERVISION_API: '/api/supervision/',
    fetch: fetchImpl || (async () => ({ ok: true, json: async () => ({ schedule: [] }) })),
    alert: () => {},
    console,
  };
  vm.createContext(context);
  context.renderApp = () => { context.renderAppCallCount++; };

  vm.runInContext(`const SUPERVISION_DAYS = ${supervisionDaysSrc};`, context);
  vm.runInContext(getDraftKeySrc, context);
  vm.runInContext(persistDraftSrc, context);
  vm.runInContext(clearDraftSrc, context);
  vm.runInContext(loadPersistedDraftSrc, context);
  vm.runInContext(isDirtySrc, context);
  vm.runInContext(togglePickerSelectSrc, context);
  vm.runInContext(ensureDraftSrc, context);
  vm.runInContext(togglePickerSrc, context);
  vm.runInContext(addSelectedSrc, context);
  vm.runInContext(removeTeacherSrc, context);
  vm.runInContext(saveScheduleSrc, context);

  return { context, fakeLocalStorage, storageMap };
}

test('1) __supervisionTogglePickerSelect يحفظ تحديدات المعلمين في الذاكرة دون أن تضيع عند إعادة الرسم', () => {
  const { context } = buildSandbox();
  context.__supervisionTogglePickerSelect(1, 't-1', true);
  context.__supervisionTogglePickerSelect(1, 't-2', true);
  context.__supervisionTogglePickerSelect(2, 't-3', true);

  assert.equal(context.__supervisionPickerSelected[1].has('t-1'), true);
  assert.equal(context.__supervisionPickerSelected[1].has('t-2'), true);
  assert.equal(context.__supervisionPickerSelected[2].has('t-3'), true);

  // إلغاء تحديد
  context.__supervisionTogglePickerSelect(1, 't-1', false);
  assert.equal(context.__supervisionPickerSelected[1].has('t-1'), false);
  assert.equal(context.__supervisionPickerSelected[1].has('t-2'), true);
});

test('2) __supervisionAddSelected يدمج الاختيارات المحفوظة ويحفظ المسودة في localStorage', () => {
  const { context, fakeLocalStorage } = buildSandbox();
  context.__supervisionSchedule = { schedule: [] };
  context.__ensureSupervisionDraft();

  context.__supervisionTogglePickerSelect(1, 't-1', true);
  context.__supervisionTogglePickerSelect(1, 't-2', true);
  context.__supervisionAddSelected(1);

  assert.deepEqual([...context.__supervisionDraftSchedule[1]].sort(), ['t-1', 't-2']);
  assert.equal(context.__supervisionAddOpenDay, null);

  // التحقق من الحفظ في localStorage
  const stored = fakeLocalStorage.getItem('nibras_supervision_draft_v1_girls');
  assert.ok(stored, 'يجب تخزين المسودة في localStorage');
  const parsed = JSON.parse(stored);
  assert.deepEqual(parsed.schedule[1].sort(), ['t-1', 't-2']);
});

test('3) محاكاة F5: استعادة المسودة بعد إعادة تحميل الصفحة من localStorage', () => {
  const { context, fakeLocalStorage } = buildSandbox();
  fakeLocalStorage.setItem('nibras_supervision_draft_v1_girls', JSON.stringify({
    ts: Date.now(),
    schedule: { 1: ['teacher-recovered-1'], 3: ['teacher-recovered-3'] }
  }));

  // محاكاة حالة بعد F5: المسودة فارغة في الذاكرة
  context.__supervisionSchedule = { schedule: [] };
  context.__supervisionDraftSchedule = null;

  context.__ensureSupervisionDraft();
  assert.ok(context.__supervisionDraftSchedule);
  assert.deepEqual([...context.__supervisionDraftSchedule[1]], ['teacher-recovered-1']);
  assert.deepEqual([...context.__supervisionDraftSchedule[3]], ['teacher-recovered-3']);
  assert.equal(context.__supervisionDraftSchedule[2].size, 0);
});

test('4) __isSupervisionDraftDirty يكتشف التغييرات غير المحفوظة مقارنة بالخادم بدقة', () => {
  const { context } = buildSandbox();
  context.__supervisionSchedule = {
    schedule: [{ dayOfWeek: 1, teacherId: 't-1' }]
  };
  context.__ensureSupervisionDraft();
  assert.equal(context.__isSupervisionDraftDirty(), false, 'لا توجد تعديلات عند التطابق مع الخادم');

  // إضافة معلم
  context.__supervisionDraftSchedule[1].add('t-2');
  assert.equal(context.__isSupervisionDraftDirty(), true, 'يجب اكتشاف وجود تعديل غير محفوظ');

  // إزالة المعلم والعودة للأصل
  context.__supervisionDraftSchedule[1].delete('t-2');
  assert.equal(context.__isSupervisionDraftDirty(), false, 'تعود false عند تطابق المسودة مع الخادم');
});

test('5) __saveSupervisionSchedule يحفظ في الخادم ويمسح المسودة من localStorage عند النجاح', async () => {
  let sentBody = null;
  const { context, fakeLocalStorage } = buildSandbox({
    fetchImpl: async (url, opts) => {
      sentBody = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ schedule: sentBody.schedule }) };
    }
  });

  context.__supervisionSchedule = { schedule: [] };
  context.__ensureSupervisionDraft();
  context.__supervisionDraftSchedule[1].add('t-save-1');
  context.__persistSupervisionDraft();

  assert.ok(fakeLocalStorage.getItem('nibras_supervision_draft_v1_girls'));

  await context.__saveSupervisionSchedule();

  assert.ok(sentBody);
  assert.deepEqual(sentBody.schedule, [{ dayOfWeek: 1, teacherId: 't-save-1' }]);
  assert.equal(context.__supervisionDraftSchedule, null, 'المسودة بالذاكرة تصفر بعد الحفظ');
  assert.equal(fakeLocalStorage.getItem('nibras_supervision_draft_v1_girls'), null, 'مسح المسودة من التخزين بعد الحفظ الناجح');
});

test('6) التحقق من حفظ الجدول واسترجاعه بعد محاكاة تحديث الصفحة F5 وإعادة تشغيل الخادم', async () => {
  // جدول في قاعدة بيانات PostgreSQL المحاكية
  const dbRows = [];
  const fakeDb = {
    async replaceSupervisionSchedule(school, assignments) {
      dbRows.length = 0;
      assignments.forEach(a => {
        dbRows.push({ school, day_of_week: Number(a.dayOfWeek), teacher_id: String(a.teacherId), enabled: true, name: 'معلم ' + a.teacherId });
      });
      return dbRows;
    },
    async getSupervisionSchedule(school) {
      return dbRows.filter(r => r.school === school);
    }
  };

  // خطوة أ: حفظ مشرف لليوم الأول (الاثنين) واليوم الخامس (الجمعة)
  await fakeDb.replaceSupervisionSchedule('GIRLS', [
    { dayOfWeek: 1, teacherId: 'teacher-mon' },
    { dayOfWeek: 5, teacherId: 'teacher-fri' }
  ]);

  // خطوة ب: استرجاع الجدول
  const initial = await fakeDb.getSupervisionSchedule('GIRLS');
  assert.equal(initial.length, 2);
  assert.equal(initial[0].teacher_id, 'teacher-mon');
  assert.equal(initial[1].teacher_id, 'teacher-fri');

  // خطوة ج: محاكاة F5 (صفحة جديدة، ذاكرة جديدة)
  const { context: ctxAfterF5 } = buildSandbox({
    fetchImpl: async (url) => {
      if (url.includes('/schedule')) {
        const rows = await fakeDb.getSupervisionSchedule('GIRLS');
        return {
          ok: true,
          json: async () => ({
            ok: true,
            school: 'GIRLS',
            schedule: rows.map(r => ({ dayOfWeek: r.day_of_week, teacherId: r.teacher_id, name: r.name, enabled: r.enabled }))
          })
        };
      }
      return { ok: true, json: async () => ({}) };
    }
  });

  const res = await ctxAfterF5.fetch('/api/supervision/schedule');
  ctxAfterF5.__supervisionSchedule = await res.json();
  ctxAfterF5.__ensureSupervisionDraft();

  assert.ok(ctxAfterF5.__supervisionDraftSchedule[1].has('teacher-mon'), 'بقاء مشرف يوم الاثنين بعد F5');
  assert.ok(ctxAfterF5.__supervisionDraftSchedule[5].has('teacher-fri'), 'بقاء مشرف يوم الجمعة بعد F5');
  assert.equal(ctxAfterF5.__supervisionDraftSchedule[2].size, 0, 'اليوم الذي لم يضف له مشرف يبقى فارغاً');

  // خطوة د: محاكاة إعادة تشغيل الخادم Server Restart
  // البيانات مستقرة في قاعدة البيانات (fakeDb / PostgreSQL) وتُقرأ كما هي بعد الإقلاع
  const rowsAfterRestart = await fakeDb.getSupervisionSchedule('GIRLS');
  assert.equal(rowsAfterRestart.length, 2);
  assert.deepEqual(
    rowsAfterRestart.map(r => ({ day: r.day_of_week, teacher: r.teacher_id })),
    [
      { day: 1, teacher: 'teacher-mon' },
      { day: 5, teacher: 'teacher-fri' }
    ],
    'البيانات باقية بالكامل بعد إعادة تشغيل الخادم'
  );
});

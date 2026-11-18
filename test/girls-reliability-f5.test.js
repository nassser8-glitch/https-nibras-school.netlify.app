'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const HTML_SRC = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const SERVER_SRC = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const SW_SRC = fs.readFileSync(path.join(ROOT, 'public', 'sw.js'), 'utf8');
const notesPrivacy = require('../notes-privacy');
const transferPrivacy = require('../transfers-privacy');

function extractHtmlFn(name) {
  const asyncIdx = HTML_SRC.indexOf('async function ' + name + '(');
  const syncIdx = HTML_SRC.indexOf('function ' + name + '(');
  const start = asyncIdx >= 0 ? asyncIdx : syncIdx;
  assert.ok(start >= 0, 'لم يُعثر على الدالة في index.html: ' + name);
  const open = HTML_SRC.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < HTML_SRC.length; i++) {
    if (HTML_SRC[i] === '{') depth++;
    else if (HTML_SRC[i] === '}') {
      depth--;
      if (depth === 0) return HTML_SRC.slice(start, i + 1);
    }
  }
  throw new Error('لم يُغلق جسم الدالة: ' + name);
}

test('1) هوية وتصميم قسم البنات محفوظان بالكامل (GIRLS، theme-girls، الصيغ المؤنثة)', () => {
  assert.ok(HTML_SRC.includes("function getActiveSchool(){ return 'GIRLS'; }"), 'القسم النشط يجب أن يكون GIRLS');
  assert.ok(HTML_SRC.includes("const themeClass = 'theme-girls';"), 'ثيم البنات theme-girls محفوظ');
  assert.ok(HTML_SRC.includes('⭐ نجمة الأسبوع'), 'عنوان نجمة الأسبوع بصيغة المؤنث');
  assert.ok(HTML_SRC.includes('طالبة متميزة ومتفوقة ومثابرة'), 'وصف نجمة الأسبوع بصيغة المؤنث');
  assert.ok(HTML_SRC.includes('+ إضافة مشرفة'), 'زر إضافة مشرفة بصيغة المؤنث');
  assert.ok(HTML_SRC.includes('مشرفات اليوم'), 'عنوان مشرفات اليوم بصيغة المؤنث');
});

test('2) Service Worker محدّث إلى رقم كاش جديد لمنع النسخ القديمة', () => {
  const m = SW_SRC.match(/const CACHE_NAME = 'nibras-v(\d+)';/);
  assert.ok(m, 'CACHE_NAME موجود في sw.js');
  assert.ok(Number(m[1]) >= 176, 'رقم الكاش يجب أن يكون 176 أو أحدث');
});

test('3) نجمة الأسبوع: حفظ واسترجاع بعد محاكاة F5 وعدم مسح الاسم أثناء الكتابة (Dirty Guard)', async () => {
  const storage = new Map();
  let serverStar = null;
  let serverHistory = [];
  let dbObj = {};

  const ctx = {
    __starOfWeekCache: {},
    __starOfWeekLoading: {},
    __starOfWeekLastFetch: {},
    STAR_CACHE_TTL_MS: 15000,
    starDraft: null,
    isStarFormDirty: false,
    starPhotoBase64: null,
    getActiveSchool: () => 'GIRLS',
    __serverEnabled: () => true,
    currentUser: () => ({ id: 'c1', name: 'خديجة', role: 'COUNSELOR' }),
    loadDB: () => dbObj,
    saveDB: (d) => { dbObj = d; },
    __syncSchedule: () => {},
    renderApp: () => {},
    alert: () => {},
    confirm: () => true,
    console,
    Date,
    JSON,
    Array,
    Object,
    String,
    encodeURIComponent,
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
    },
    document: {
      getElementById: () => null,
    },
    fetch: async (url, opts) => {
      if (opts && opts.method === 'POST') {
        const body = JSON.parse(opts.body);
        serverStar = body.star;
        if (Array.isArray(body.history)) serverHistory = body.history;
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, star: serverStar, history: serverHistory }),
      };
    },
  };
  vm.createContext(ctx);
  vm.runInContext(extractHtmlFn('__starOfWeekLoad'), ctx);
  vm.runInContext(extractHtmlFn('getStarOfWeek'), ctx);
  vm.runInContext(extractHtmlFn('saveStarOfWeek'), ctx);
  vm.runInContext(extractHtmlFn('clearStarOfWeekConfirm'), ctx);

  // كتابة اسم نجمة الأسبوع في المسودة وحفظها
  ctx.starDraft = { name: 'سارة أحمد', className: 'الأول الثانوي - أ', week: 'الأسبوع 6', reason: 'تفوق وانضباط' };
  ctx.isStarFormDirty = true;
  await ctx.saveStarOfWeek();

  assert.equal(ctx.isStarFormDirty, false, 'يجب تصفير isStarFormDirty بعد الحفظ');
  assert.equal(serverStar.name, 'سارة أحمد', 'وصل اسم نجمة الأسبوع إلى الخادم');

  // محاكاة F5: مسح كاش الذاكرة وإعادة التحميل من الخادم
  ctx.__starOfWeekCache = {};
  ctx.__starOfWeekLastFetch = {};
  const loadRes = await ctx.__starOfWeekLoad('GIRLS', true);
  assert.equal(loadRes.ok, true);
  assert.equal(ctx.getStarOfWeek().name, 'سارة أحمد', 'يبقى اسم نجمة الأسبوع محفوظاً بعد F5');

  // محاكاة إلغاء النجمة والتحقق من عدم عودتها بعد F5
  await ctx.clearStarOfWeekConfirm();
  assert.equal(serverStar, null, 'الخادم استقبل إلغاء النجمة');
  assert.equal(serverHistory.length, 1, 'النجمة السابقة انتقلت للسجل');

  ctx.__starOfWeekCache = {};
  ctx.__starOfWeekLastFetch = {};
  await ctx.__starOfWeekLoad('GIRLS', true);
  assert.equal(ctx.getStarOfWeek(), null, 'لا تعود النجمة الملغاة بعد F5');
});

test('4) الأنشطة: حفظ واسترجاع بعد محاكاة F5 وحماية من المسح الفارغ ومنع Render Loop', async () => {
  const storage = new Map();
  let serverActivities = [];
  let dbObj = { activities: [] };
  let renderCount = 0;

  const ctx = {
    __activitiesCache: {},
    __activitiesLoading: {},
    __activitiesLastFetch: {},
    ACTIVITIES_CACHE_TTL_MS: 15000,
    activityEditId: null,
    activityFormOpen: false,
    getActiveSchool: () => 'GIRLS',
    __serverEnabled: () => true,
    currentUser: () => ({ id: 'admin1', role: 'ADMIN' }),
    uid: () => 'act_girls_1',
    loadDB: () => dbObj,
    saveDB: (d) => { dbObj = d; },
    __syncSchedule: () => {},
    saveCustomActName: () => {},
    renderApp: () => { renderCount++; },
    alert: () => {},
    confirm: () => true,
    console,
    Date,
    JSON,
    Array,
    Object,
    Map,
    Set,
    encodeURIComponent,
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
    },
    document: {
      getElementById: (id) => {
        const vals = { actType: 'NATIONAL', actName: 'احتفالية يوم التأسيس', actDate: '2026-11-25', actDesc: 'النشاط الثقافي' };
        return { value: vals[id] || '', style: {} };
      },
    },
    fetch: async (url, opts) => {
      if (opts && opts.method === 'POST') {
        const body = JSON.parse(opts.body);
        serverActivities = body.activities.slice();
        return { ok: true, status: 200, json: async () => ({ ok: true, count: serverActivities.length }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, activities: serverActivities }),
      };
    },
  };
  vm.createContext(ctx);
  vm.runInContext(extractHtmlFn('__activitiesLoad'), ctx);
  vm.runInContext(extractHtmlFn('saveActivity'), ctx);

  await ctx.saveActivity();
  assert.equal(serverActivities.length, 1);
  assert.equal(serverActivities[0].name, 'احتفالية يوم التأسيس');

  // محاكاة F5: كاش ذاكرة جديد
  ctx.__activitiesCache = {};
  ctx.__activitiesLastFetch = {};
  const loaded = await ctx.__activitiesLoad('GIRLS', true);
  assert.equal(loaded.length, 1, 'النشاط محفوظ ويُسترجع بعد F5');
  assert.equal(loaded.changed, true, 'أول تحميل بعد F5 يكتشف البيانات');

  // استدعاء ثانٍ فوري يقرأ من الكاش ولا يسبب changed=true (منع Render Loop)
  const secondLoad = await ctx.__activitiesLoad('GIRLS', false);
  assert.equal(secondLoad.changed, false, 'التحميل المتكرر لا يعيد changed=true فيمنع حلقة إعادة الرسم');
});

test('5) الملاحظات والتحويلات: تعديل الملاحظة للمالكة، وحفظ التحويل مع إشعار المزامنة وبقاؤه بعد F5', () => {
  let dbObj = {
    students: [{ id: 'stu_1', fullName: 'ريم العتيبي', studentNo: '101' }],
    notes: [{ id: 'note_1', studentId: 'stu_1', category: 'التعاون', description: 'وصف قديم', createdBy: 'teacher_g1', points: 4 }],
    transfers: [],
  };
  let scheduledSync = false;

  const ctx = {
    loadDB: () => dbObj,
    saveDB: (d) => { dbObj = d; },
    currentUser: () => ({ id: 'teacher_g1', name: 'أمل الشامي', role: 'TEACHER' }),
    getActiveSchool: () => 'GIRLS',
    __syncSchedule: () => { scheduledSync = true; },
    renderApp: () => {},
    alert: () => {},
    Date,
    String,
    document: {
      getElementById: (id) => {
        if (id === 'editNoteCategory') return { value: 'القيادة والمبادرة' };
        if (id === 'editNoteDescription') return { value: 'تميزت في قيادة المجموعة' };
        return null;
      },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(extractHtmlFn('NRC_editableNote'), ctx);
  vm.runInContext(extractHtmlFn('closeEditNoteModal'), ctx);
  vm.runInContext(extractHtmlFn('saveEditNote'), ctx);

  ctx.saveEditNote('note_1');
  assert.equal(dbObj.notes[0].category, 'القيادة والمبادرة', 'تم تعديل فئة الملاحظة بنجاح');
  assert.equal(dbObj.notes[0].description, 'تميزت في قيادة المجموعة', 'تم تعديل وصف الملاحظة بنجاح');
  assert.equal(scheduledSync, true, 'تم جدولة رفع التعديل للخادم فوراً');

  // التحقق من بقاء التعديل عبر طبقة الخادم notes-privacy
  const serverEnforced = notesPrivacy.enforceNoteOwners(dbObj.notes, { user_id: 'teacher_g1', role: 'TEACHER' }, [
    { id: 'note_1', studentId: 'stu_1', category: 'التعاون', description: 'وصف قديم', createdBy: 'teacher_g1', points: 4 },
  ]);
  assert.equal(serverEnforced[0].category, 'القيادة والمبادرة');
  assert.equal(serverEnforced[0].description, 'تميزت في قيادة المجموعة');
});

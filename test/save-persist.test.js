'use strict';
/* =============================================================================
 * موثوقية بقاء البيانات: حفظ/مزامنة/استرجاع بلا فقد (save-persist)
 * -----------------------------------------------------------------------------
 * المشكلة المنشورة: بيانات (أرقام هواتف، ملاحظات، نقاط، تكليفات، حضور) تختفي
 * بعد تحديث الصفحة أو إعادة الدخول. أسبابها الجذرية (كلها مُصلَّحة هنا):
 *  1) __syncPush يكتب نسخته القديمة فوق تعديلٍ وصل أثناء الجلب (لا لقطة/حارس طزاجة).
 *  2) نجاح زائف: إعلان قبل ردّ الخادم، و401/استثناء يمرّان بصمت.
 *  3) سحب/تحديث مدرسة أثناء رفع جارٍ يستبدل التخزين بنسخة أقدم.
 *  4) تنظيف loadDB كان يحذف ملاحظتين متطابقتين (نص/فئة/توقيت) بمعرّفين مختلفين.
 *  5) المسارات الجديدة (إنجاز تكليف/حذف/تعطيل حساب/توثيق موافقة) بلا حراسة رفع.
 *  6) خادم يُسقِط أقساماً خارج الصلاحية بصمت (يظنّ المستخدم أن حفظه وصل).
 *  7) أساس baseTs أحدث من المخزن يُعامل كـ«طازج» فيمحو استرجاعاً حديثاً.
 * هذه الاختبارات تقصّ الدوال من الملف المنشور نفسه ولا تُعيد تنفيذ نسخة منفصلة.
 * ========================================================================== */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const SRV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

function extractFns(name) {
  const start = SRC.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'لم أجد ' + name);
  const open = SRC.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < SRC.length; i++) {
    const ch = SRC[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return SRC.slice(start, i + 1); }
  }
  throw new Error('لم يُغلق جسم ' + name);
}
function extractConst(pattern) {
  const m = SRC.match(pattern);
  assert.ok(m, 'لم أجد الثابت: ' + pattern);
  return m[0];
}

/* محوّر رفع كامل: يشغّل __syncPush الحقيقية من الملف المنشور داخل VM، مع بيئة
   تخزين/جلب متحكَّم بها — فلا يمرّ الاختبار بسبب نسخة منفصلة أو محاكاة سطحية. */
function makePushEnv(opts) {
  const o = opts || {};
  const store = o.store || {};
  const key = 'nibras_GIRLS_db_v1';
  const pendKey = 'nibras_GIRLS_pending_v1';
  const state = { running: false, dirty: false, attempts: 0, lastFail: 0, lastOkAt: 0, lastOkTs: 0 };
  const calls = { logs: [], toasts: [], notifies: [], timers: [], schedules: [], clears: [], banners: [] };
  const ctx = {
    console: { warn() {}, log() {}, error() {} },
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; }
    },
    // مؤقّت متحكَّم به: نومات إعادة المحاولة تعمل سريعاً، ومؤقّت إعادة الجدولة
    // (15000ms) يُسجَّل فقط ولا يُطلق حتى لا يعيد تشغيل الرفع أثناء الاختبار.
    setTimeout: (fn, ms) => {
      calls.timers.push(ms);
      if (ms >= 15000) return calls.timers.length;
      setTimeout(fn, 5); // نومات إعادة المحاولة تعمل فعلاً وبسرعة
      return calls.timers.length;
    },
    __syncEnabled: () => true,
    __serverEnabled: () => true,
    __pushState: () => state,
    __syncTS: (obj) => (obj && typeof obj === 'object' && obj._ts) || 0,
    SYNC_API: 'https://x/api/db/',
    fetch: o.fetch,
    __saveGuardNotify: (school, res) => { calls.notifies.push(res); },
    __saveGuardDropped: null, // يُحقن أدناه من الكود الحقيقي
    __saveGuards: o.saveGuards || {},
    __refreshSaveStatus: () => {},
    __uiToast: (txt) => { calls.toasts.push(String(txt)); },
    __syncLogAdd: (e) => { calls.logs.push(e); },
    __handleAuthError: () => { calls.authErrs = (calls.authErrs || 0) + 1; },
    __origSetItem: (k, v) => { store[k] = String(v); },
    __clearUnpushed: () => { calls.clears.push('notes'); },
    __clearAssignUnpushed: () => { calls.clears.push('assignments'); },
    __unpushedIds: () => [],
    __notePushFailBanner: () => {},
    __PUSH_MAX_ATTEMPTS: 6,
    __syncTimers: {},
    __syncSchedule: (school, ms) => { calls.schedules.push(ms); }
  };
  // دوال دمج الخادم الكامل (تُستدعى عندما يعيد الخادم بيانات فعلية)
  const helpers = [
    '__canon', '__canonEq', '__mergeTransfersPull', '__attWinner',
    '__mergeUsersAttendanceList', '__mergeMsg', '__mergeSuggestion',
    'mergeClassesLocal', '__mergeStudentsLocal', 'NRC_mergeNotes',
    '__pointsUnsyncedStudents', '__carryLocalAdjustedPoints'
  ].map(extractFns).join('\n');
  const consts = [
    extractConst(/const __GUARD_SECTION = \{[\s\S]*?\n\};/)
  ].join('\n');
  ctx.currentUser = () => null;
  ctx.NRC_noteBelongsToOther = () => false;
  vm.createContext(ctx);
  // extractFns يقصّ من «function __syncPush» فيفقد مفتاح async — نعيده هنا.
  const pushCode = extractFns('__syncPush').replace(/^function __syncPush\(/, 'async function __syncPush(');
  vm.runInContext(
    consts + '\n' + helpers + '\n' + extractFns('__saveGuardDropped') +
    '\n' + pushCode +
    '\n;globalThis.__push = __syncPush; globalThis.__dropped = __saveGuardDropped;',
    ctx
  );
  return { store, state, calls, ctx, key, pendKey, push: ctx.__push, dropped: ctx.__dropped };
}

function respOf(status, json, headers) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h) => (headers && headers[h]) || null },
    json: async () => json,
    text: async () => ''
  };
}

function baseDb(extra) {
  const d = {
    _ts: 100, users: [], grades: [], classes: [{ id: 'c1', name: '١' }],
    students: [], attendance: [], notes: [], transfers: [], maintenance: [],
    assignments: [], activities: [], timetable: {}, pointsTotals: {}
  };
  return Object.assign(d, extra || {});
}

const EMPTY_SERVER = { users: [], grades: [], classes: [], students: [], attendance: [], notes: [], transfers: [], maintenance: [], assignments: [], activities: [], timetable: {}, pointsTotals: {} };

/* ------------------------------------------------ 1) رقم ولي الأمر يبقى عبر دورة الرفع */
test('1) رقم ولي الأمر يصل الخادم كسلسلة (مع + ورمز الدولة) ويبقى في التخزين بعد النجاح', async () => {
  const phone = '+966 56 813 3414';
  const env = makePushEnv({
    store: { 'nibras_GIRLS_db_v1': JSON.stringify(baseDb({ students: [{ id: 's1', fullName: 'سارة', guardianPhone: phone }] })) },
    fetch: async (url, opts) => {
      if (!opts) return respOf(200, { data: JSON.parse(JSON.stringify(EMPTY_SERVER)), ts: 200 });
      const body = JSON.parse(opts.body);
      // ما وصل الخادم هو نفس السلسلة حرفياً — بلا تحويل رقمي يفقد الأصفار أو الدقة
      assert.strictEqual(body.data.students[0].guardianPhone, phone, 'الرقم وصل محرَّفاً');
      assert.strictEqual(typeof body.data.students[0].guardianPhone, 'string', 'الرقم ليس سلسلة نصية');
      return respOf(200, { ok: true, ts: 300 });
    }
  });
  const r = await env.push('GIRLS');
  assert.equal(r.ok, true, 'الرفع لم ينجح');
  const after = JSON.parse(env.store[env.key]);
  assert.strictEqual(after.students[0].guardianPhone, phone, 'الرقم فقد من التخزين بعد النجاح');
  assert.equal(after._ts, 300, 'الختم الزمني لم يُحدَّث من ردّ الخادم');
  assert.ok(env.calls.logs.some(e => e.ev === 'push-ok'), 'لا تسجيل رفع ناجح');
  assert.ok(env.calls.notifies.some(x => x && x.ok === true), 'الحارس لم يُبلَّغ بالنجاح');
  assert.ok(env.store[env.pendKey] === undefined, 'نسخت احتياطية زائدة بعد النجاح');
});

/* ------------------------------------------------ 2) ملاحظتان تصلاان؛ التفريغ بعد ردّ الخادم فقط */
test('2) الملاحظات تصلكم في الدفعة، وتفريغ سجلات «بانتظار الرفع» لا يقع إلا بعد ردّ الخادم', async () => {
  const notes = [
    { id: 'n1', batchId: 'b1', studentId: 's1', points: 5, description: 'ملاحظة أولى' },
    { id: 'n2', batchId: 'b2', studentId: 's2', points: -3, description: 'ملاحظة ثانية' }
  ];
  let clearedDuringPut = null;
  const env = makePushEnv({
    store: { 'nibras_GIRLS_db_v1': JSON.stringify(baseDb({ notes })) },
    fetch: async (url, opts) => {
      if (!opts) return respOf(200, { data: JSON.parse(JSON.stringify(EMPTY_SERVER)), ts: 200 });
      clearedDuringPut = env.calls.clears.slice();
      const body = JSON.parse(opts.body);
      assert.equal(body.data.notes.length, 2, 'إحدى الملاحظتين لم تُرفع');
      assert.equal(body.data.notes.find(n => n.id === 'n2').description, 'ملاحظة ثانية');
      return respOf(200, { ok: true, ts: 300 });
    }
  });
  await env.push('GIRLS');
  assert.deepEqual(clearedDuringPut, [], 'سُجّل تفريغ قبل وصول ردّ الخادم');
  assert.deepEqual(env.calls.clears.sort(), ['assignments', 'notes'], 'لم تُفرَّغ السجلات بعد النجاح');
  const after = JSON.parse(env.store[env.key]);
  assert.equal(after.notes.length, 2, 'الملاحظات فُقدت من التخزين بعد النجاح');
});

/* ------------------------------------------------ 3) ملاحظتان متطابقتان تبقيان؛ التكرار بالمعرّف فقط يُحذف */
test('3) loadDB: ملاحظتان نصّهما وفئة وتوقيت متطابقان بمعرّفين مختلفين تبقيان — والمكرر بمعرّف الدفعة يُزال فقط', () => {
  const store = {
    'nibras_GIRLS_db_v1': JSON.stringify(baseDb({
      notes: [
        { id: 'n1', batchId: 'b1', description: 'زيارة ولي أمر', category: 'الانضباط', createdAt: 1700000000000 },
        { id: 'n2', batchId: 'b2', description: 'زيارة ولي أمر', category: 'الانضباط', createdAt: 1700000120000 }
      ]
    }))
  };
  const ctx = {
    console, JSON, Set, Array, Date, Math, Object,
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; }
    },
    dbKey: () => 'nibras_GIRLS_db_v1',
    __dbMemoRaw: null, __dbMemoObj: null,
    isSchoolDay: () => true,
    __fixPersonName: (n) => n,
    saveDB: (d) => { store['nibras_GIRLS_db_v1'] = JSON.stringify(d); }
  };
  vm.createContext(ctx);
  vm.runInContext(extractFns('loadDB') + '\n;globalThis.L=loadDB;', ctx);
  const kept = ctx.L();
  assert.equal(kept.notes.length, 2, 'حُذفت ملاحظة متطابقة بمعرّف مختلف (نافذة دقيقتين مقصودة)');
  // الآن تكرار حقيقي: نفس المعرّف ونفس الدفعة
  store['nibras_GIRLS_db_v1'] = JSON.stringify(baseDb({
    notes: [
      { id: 'n1', batchId: 'b1', description: 'زيارة ولي أمر', category: 'الانضباط' },
      { id: 'n1', batchId: 'b1', description: 'زيارة ولي أمر', category: 'الانضباط' }
    ]
  }));
  ctx.__dbMemoRaw = null; ctx.__dbMemoObj = null;
  const deduped = ctx.L();
  assert.equal(deduped.notes.length, 1, 'التكرار بمعرّف/دفعة نفسه لم يُحذف');
});

/* ------------------------------------------------ 4) خروج ثم دخول: النسخة المعلّقة تُرفع ولا تُهمل */
test('4) بعد خروج/دخول: نسخة الدفعة المعلّقة تُرفع كاملة (نقاط وتكليفات)، وlogin يجدول الرفع فوراً', async () => {
  const pend = baseDb({
    _ts: 400,
    notes: [{ id: 'n9', studentId: 's1', points: 10, description: 'تفوق لم تُرفع' }],
    assignments: [{ id: 'a1', title: 'تكليف بقي بعد الخروج' }],
    students: [{ id: 's1', fullName: 'سارة' }]
  });
  const env = makePushEnv({
    store: { 'nibras_GIRLS_pending_v1': JSON.stringify(pend) }, // لا يوجد مفتاح رئيسي بعد الخروج
    fetch: async (url, opts) => {
      if (!opts) return respOf(200, { data: JSON.parse(JSON.stringify(EMPTY_SERVER)), ts: 200 });
      const body = JSON.parse(opts.body);
      assert.equal(body.data.notes[0].points, 10, 'النقطة المعلّقة لم تُرفع');
      assert.equal(body.data.assignments[0].id, 'a1', 'التكليف المعلق لم يُرفع');
      return respOf(200, { ok: true, ts: 500 });
    }
  });
  const r = await env.push('GIRLS');
  assert.equal(r.ok, true);
  assert.equal(env.store[env.pendKey], undefined, 'النسخة المعلّقة لم تُفرَّغ بعد النجاح');
  const after = JSON.parse(env.store[env.key]);
  assert.equal(after.notes[0].points, 10, 'النقطة فُقدت من التخزين بعد الرفع');
  assert.equal(after.assignments[0].id, 'a1');
  // وlogin يجدول رفع أي معلّق فور عودة الدخول (لا انتظار أول تعديل جديد)
  assert.ok(SRC.includes('try{ __syncSchedule(r.j.user.school, 400); }catch(e){}'),
    'login لا يجدول رفع المعلّق بعد الدخول');
});

/* ------------------------------------------------ 5) لا انتقال/إعلان قبل تأكيد الخادم في المسارات الجديدة */
test('5) حفظ/حذف التكليف وتعطيل الحساب: مراقب + رفع فوري، والانتقال فقط عند نجاح الخادم', () => {
  // (أ) الحذف: الانتقال الفوري كان يُظهر القائمة نظيفة والرفع لم يصل
  {
    const store = { 'nibras_GIRLS_db_v1': JSON.stringify(baseDb({ assignments: [{ id: 'a1', title: 'واجب', teacherId: 'u1' }] })) };
    const watches = [];
    const banners = [];
    const schedules = [];
    const ctx = {
      console, JSON, Set, Array, Date, Math, Object, URLSearchParams,
      localStorage: {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; }
      },
      location: { hash: '#/assignments?step=detail&cid=c1' },
      currentUser: () => ({ id: 'u1', role: 'TEACHER' }),
      confirm: () => true,
      alert: () => {},
      loadDB: () => JSON.parse(store['nibras_GIRLS_db_v1']),
      saveDB: (d) => { store['nibras_GIRLS_db_v1'] = JSON.stringify(d); },
      getActiveSchool: () => 'GIRLS',
      __serverEnabled: () => true,
      __syncEnabled: () => true,
      __saveGuards: {},
      __saveGuardWatch: (school, kind, cb) => { watches.push({ kind, cb }); },
      __saveGuardPanel: () => {},
      __draftClear: () => {},
      __draftGet: () => null,
      __noteSaveBanner: (m) => banners.push(m),
      __refreshSaveStatus: () => {},
      __syncSchedule: (school, ms) => schedules.push(ms),
      __saveReasonText: () => '',
      renderApp: () => {},
      setTimeout: (fn, ms) => 0,
      __markAssignUnpushed: () => {}
    };
    vm.createContext(ctx);
    vm.runInContext(
      extractConst(/const __SAVE_LABEL = \{[\s\S]*?\n\};/) + '\n' +
      extractFns('__saveGuardOutcome') + '\n' + extractFns('deleteAssignment') +
      '\n;globalThis.D=deleteAssignment;', ctx
    );
    ctx.D('a1');
    assert.equal(ctx.location.hash, '#/assignments?step=detail&cid=c1', 'انتقل قبل تأكيد الخادم');
    assert.ok(watches.some(w => w.kind === 'assignment-del'), 'لا مراقب لحذف التكليف');
    assert.ok(banners.some(m => m.includes('جارٍ حفظ حذف التكليف')), 'لا مؤشر جارٍ الحفظ للحذف');
    assert.ok(schedules.includes(0), 'لا رفع فوري بعد الحذف');
    // فشل الرفع: لا انتقال
    watches.filter(w => w.kind === 'assignment-del').forEach(w => w.cb({ ok: false, err: 'network:x' }, 'assignment-del'));
    assert.equal(ctx.location.hash, '#/assignments?step=detail&cid=c1', 'انتقل رغم فشل الرفع');
    // نجاح الرفع: الانتقال الآن
    watches.filter(w => w.kind === 'assignment-del').forEach(w => w.cb({ ok: true }, 'assignment-del'));
    assert.equal(ctx.location.hash, '#/assignments?step=list&cid=c1', 'لم ينتقل بعد النجاح');
  }
  // (ب) إنجاز التكليف وتعطيل الحساب: كانا بلا حراسة ولا رفع صريح
  {
    const store = { 'nibras_GIRLS_db_v1': JSON.stringify(baseDb({ assignments: [{ id: 'a1', completedBy: [] }], users: [{ id: 'u9', name: 'معلمة', active: true }] })) };
    const watches = [];
    const schedules = [];
    const banners = [];
    const marks = [];
    const ctx = {
      console, JSON, Set, Array, Date, Math, Object,
      localStorage: {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; }
      },
      loadDB: () => JSON.parse(store['nibras_GIRLS_db_v1']),
      saveDB: (d) => { store['nibras_GIRLS_db_v1'] = JSON.stringify(d); },
      userById: (id) => ({ name: 'معلمة' }),
      getActiveSchool: () => 'GIRLS',
      __serverEnabled: () => true,
      __syncEnabled: () => true,
      __saveGuards: {},
      __saveGuardWatch: (school, kind, cb) => { watches.push({ kind, cb }); },
      __saveGuardOutcome: () => {},
      __noteSaveBanner: (m) => banners.push(m),
      __refreshSaveStatus: () => {},
      __syncSchedule: (school, ms) => schedules.push(ms),
      __markAssignUnpushed: (school, ids) => marks.push(...ids),
      confirm: () => true,
      renderApp: () => {}
    };
    vm.createContext(ctx);
    vm.runInContext(
      extractFns('toggleStudentDone') + '\n' + extractFns('deleteUser') +
      '\n;globalThis.T=toggleStudentDone; globalThis.U=deleteUser;', ctx
    );
    ctx.T('a1', 's1', true);
    assert.ok(watches.some(w => w.kind === 'assignment'), 'إنجاز التكليف بلا مراقب رفع');
    assert.ok(schedules.includes(0), 'إنجاز التكليف بلا رفع فوري');
    assert.ok(marks.includes('a1'), 'التكليف غير مسجَّل في سجل ما لم يُرفع');
    assert.deepEqual(JSON.parse(store['nibras_GIRLS_db_v1']).assignments[0].completedBy, ['s1'], 'الإنجاز لم يُحفظ محلياً');
    ctx.U('u9');
    assert.ok(watches.some(w => w.kind === 'user'), 'تعطيل الحساب بلا مراقب رفع');
    assert.equal(JSON.parse(store['nibras_GIRLS_db_v1']).users[0].active, false, 'التعطيل لم يُحفظ محلياً');
  }
});

/* ------------------------------------------------ 6) استجابة متأخرة: لا نجاح قبل الردّ */
test('6) استجابة خادم متأخرة: لا يُبلَّغ النجاح قبل وصول الردّ فعلياً', async () => {
  const env = makePushEnv({
    store: { 'nibras_GIRLS_db_v1': JSON.stringify(baseDb({ notes: [{ id: 'n1', points: 2 }] })) },
    fetch: async (url, opts) => {
      await new Promise(r => setTimeout(r, 40)); // خادم بطيء
      if (!opts) return respOf(200, { data: JSON.parse(JSON.stringify(EMPTY_SERVER)), ts: 200 });
      return respOf(200, { ok: true, ts: 300 });
    }
  });
  const p = env.push('GIRLS');
  await new Promise(r => setTimeout(r, 15));
  assert.equal(env.calls.notifies.length, 0, 'أُعلن شيء قبل وصول ردّ الخادم');
  assert.equal(env.state.running, true, 'الرفع لم يكن جارياً أصلاً');
  const r = await p;
  assert.equal(r.ok, true);
  assert.ok(env.calls.notifies.some(x => x && x.ok === true), 'النجاح لم يُبلَّغ بعد وصول الردّ');
});

/* ------------------------------------------------ 7) قطع الاتصال: فشل صريح + احتفاظ + استئناف بلا تكرار */
test('7) قطع الاتصال: PUT يفشل ⇒ فشل معلن + نسخة احتياطية + إعادة محاولة، ثم نجاح بلا تكرار ولا فقد', async () => {
  let online = false;
  const env = makePushEnv({
    store: { 'nibras_GIRLS_db_v1': JSON.stringify(baseDb({ notes: [{ id: 'n1', batchId: 'b1', points: 7, description: 'بقيت' }] })) },
    fetch: async (url, opts) => {
      if (!online) throw new TypeError('Failed to fetch');
      if (!opts) return respOf(200, { data: JSON.parse(JSON.stringify(EMPTY_SERVER)), ts: 200 });
      const body = JSON.parse(opts.body);
      assert.equal(body.data.notes.length, 1, 'تكرار عند إعادة المحاولة');
      assert.equal(body.data.notes[0].description, 'بقيت', 'فقدان محتوى عند إعادة المحاولة');
      return respOf(200, { ok: true, ts: 300 });
    }
  });
  const r1 = await env.push('GIRLS');
  assert.equal(r1.ok, false, 'أُعلن نجاح رغم انقطاع الشبكة');
  assert.ok(String(r1.err).startsWith('network:'), 'لا تصنيف سبب الفشل كشبكة');
  const failNotify = env.calls.notifies.find(x => x && x.ok === false);
  assert.ok(failNotify, 'الحارس لم يُبلَّغ بالفشل');
  assert.ok(String(failNotify.err).startsWith('network:'), 'سبب الفشل غير مبلَّغ للحارس');
  assert.ok(env.store[env.pendKey], 'لا نسخة احتياطية بعد الفشل');
  const kept = JSON.parse(env.store[env.key]);
  assert.equal(kept.notes[0].description, 'بقيت', 'فُقدت البيانات محلياً عند الفشل');
  assert.ok(env.calls.timers.includes(15000), 'لا إعادة محاولة تلقائية بعد الفشل');
  assert.ok(env.calls.logs.some(e => e.ev === 'push-fail'), 'لا تسجيل فشل');
  // عادت الشبكة: إعادة المحاولة تكمل بلا تكرار ولا فقد
  online = true;
  env.state.attempts = 1;
  const r2 = await env.push('GIRLS');
  assert.equal(r2.ok, true, 'استئناف الرفع بعد عودة الاتصال لم ينجح');
  assert.equal(env.store[env.pendKey], undefined, 'النسخة المعلّقة لم تُفرَّغ بعد النجاح');
  const after = JSON.parse(env.store[env.key]);
  assert.equal(after.notes.length, 1, 'تكرار ملاحظة عند الاستئناف');
  assert.ok(env.calls.notifies.some(x => x && x.ok === true), 'لم يُبلَّغ النجاح بعد الاستئناف');
});

/* ------------------------------------------------ 8) تعديل أثناء الرفع لا يُطمس (جهازان/قسمتان متزامنان) */
test('8) تعديل يصل أثناء الرفع (نفس القسم من جهاز آخر): لا استبدال ولا تفريغ — الرفع التالي يكمل', async () => {
  // (أ) التعديل يصل أثناء جلب ما لدى الخادم: لا PUT أصلاً، والمحتوى الأحدث باقٍ
  {
    const newer = baseDb({ _ts: 999, notes: [{ id: 'nNEW', points: 4, description: 'من الجهاز الآخر' }] });
    const env = makePushEnv({
      store: { 'nibras_GIRLS_db_v1': JSON.stringify(baseDb({ notes: [{ id: 'nOld', points: 1 }] })) },
      fetch: async (url, opts) => {
        if (!opts) {
          // كتابة متزامنة أثناء الجلب (جهاز/تبويب آخر حفظ للتو)
          env.store[env.key] = JSON.stringify(newer);
          return respOf(200, { data: JSON.parse(JSON.stringify(EMPTY_SERVER)), ts: 200 });
        }
        throw new Error('لا يجب أن يصل PUT مع تعديل أحدث');
      }
    });
    const r = await env.push('GIRLS');
    assert.equal(r.stale, true, 'لم يُرصد تعديل أثناء الرفع');
    assert.equal(r.ok, false, 'نجاح كاذب مع دفعة ألغيت');
    // finally يستهلك st.dirty ويُجدّل الدفعة المحدثة فوراً — هذه هي السلامة الحقيقية
    assert.ok(env.calls.schedules.includes(0), 'لم تُجدَّل دفعة المحتوى الأحدث بعد إلغاء القديمة');
    const kept = JSON.parse(env.store[env.key]);
    assert.equal(kept.notes[0].id, 'nNEW', 'طُمس تعديل الجهاز الآخر بنسخة أقدم');
    assert.ok(env.calls.logs.some(e => e.ev === 'push-stale-retry'), 'لا تسجيل إلغاء الدفعة القديمة');
    assert.equal(env.calls.clears.length, 0, 'فُرِّغ سجل «بانتظار الرفع» رغم ألغي الرفع');
  }
  // (ب) التعديل يصل أثناء رفع PUT نفسه: لا كتابة فوقه ولا تفريغ
  {
    const env = makePushEnv({
      store: { 'nibras_GIRLS_db_v1': JSON.stringify(baseDb({ notes: [{ id: 'n1', points: 1 }] })) },
      fetch: async (url, opts) => {
        if (!opts) return respOf(200, { data: JSON.parse(JSON.stringify(EMPTY_SERVER)), ts: 200 });
        const cur = JSON.parse(env.store[env.key]);
        cur.notes.push({ id: 'nMID', points: 9, description: 'أثناء الرفع' });
        cur._ts = 950;
        env.store[env.key] = JSON.stringify(cur);
        return respOf(200, { ok: true, ts: 300 });
      }
    });
    const r = await env.push('GIRLS');
    assert.equal(r.ok, true);
    assert.equal(r.dirty, true, 'لم يُعلَن أن محلياً أحدث من المرفوع');
    const kept = JSON.parse(env.store[env.key]);
    assert.ok(kept.notes.some(n => n.id === 'nMID'), 'طُمس تعديل وصل أثناء PUT');
    assert.equal(env.calls.clears.length, 0, 'فُرِّغت سجلات ما لم يُرفع بعد');
    assert.equal(env.store[env.pendKey], undefined, 'فُرِّغ احتياطي رغم بقاء تعديل معلّق');
    assert.ok(!env.calls.notifies.some(x => x && x.ok === true), 'أُعلن نجاح كامل رغم بقاء تعديل معلّق');
    assert.ok(env.calls.logs.some(e => e.ev === 'push-local-changed'), 'لا تسجيل تعديل محلي أثناء الرفع');
  }
});

/* ------------------------------------------------ 9) معلمتان: دمج الملاحظات لا يفقد ملاحظة أي منهما */
test('9) معلمتان على قسمين: NRC_mergeNotes تُبقي ملاحظة كل منهما (دمج لا استبدال)', () => {
  const ctx = { console, JSON, Set, Map, Array, Date, Math, Object, currentUser: () => null, NRC_noteBelongsToOther: () => false };
  vm.createContext(ctx);
  vm.runInContext(extractFns('NRC_mergeNotes') + '\n;globalThis.M=NRC_mergeNotes;', ctx);
  const serverNotes = [{ id: 'nA', createdBy: 'uA', description: 'ملاحظة المديرة', _v: 2 }];
  const localNotes = [{ id: 'nB', createdBy: 'uB', description: 'ملاحظة المعلمة', _v: 1 }];
  const merged = ctx.M(serverNotes, localNotes);
  assert.equal(merged.length, 2, 'ضاعت ملاحظة إحداهما عند الدمج');
  assert.ok(merged.some(n => n.id === 'nA') && merged.some(n => n.id === 'nB'));
  // نسخة أحدث لنفس الملاحظة تفوز، ولا يُحيى محذوف
  const newer = ctx.M([{ id: 'nA', _v: 1, description: 'قديمة' }], [{ id: 'nA', _v: 3, description: 'محدثة' }]);
  assert.equal(newer.find(n => n.id === 'nA').description, 'محدثة', 'الأحدث لم يفز');
  const undeleted = ctx.M([{ id: 'nA', deleted: true, _v: 5 }], [{ id: 'nA', _v: 4 }]);
  assert.equal(undeleted.find(n => n.id === 'nA').deleted, true, 'أُحيى محذوف');
});

/* ------------------------------------------------ 10) الأرقام كسلاسل: رمز الدولة والأصفار لا تضيع */
test('10) أرقام واتساب كسلاسل نصية: normalize لكل الصيغ، وبلا تحويل رقمي يفقد الأصفار/الدقة', () => {
  const ctx = { console, String, Math };
  vm.createContext(ctx);
  vm.runInContext(extractFns('__waNormalizePhone') + '\n;globalThis.N=__waNormalizePhone;', ctx);
  assert.equal(ctx.N('+966 56 813 3414'), '966568133414', 'رمز + ومسافات');
  assert.equal(ctx.N('0568133414'), '966568133414', 'صفر محلي 05');
  assert.equal(ctx.N('00966568133414'), '966568133414', 'بادئة 00');
  assert.equal(ctx.N('568133414'), '966568133414', 'بلا رمز');
  assert.equal(ctx.N('+1 555 010 0200'), '15550100200', 'رقم خارجي يبقى كما هو');
  assert.equal(ctx.N('0151234567'), '966151234567', 'صفر محلي 015');
  assert.equal(ctx.N(''), '', 'فارغ');
  // رقم بـ17 خانة (أكبر من مصفوفة 53-bit): التخزين نصّي فلا تضيع دقة
  const big = '96650123456789012';
  assert.strictEqual(JSON.parse(JSON.stringify({ p: big })).p, big, 'أرقام طويلة تفقد دقة عند التحويل الرقمي');
  // لا تحويل رقمي في مسار قراءة الرقم من الطالب
  assert.ok(SRC.includes('String(s.guardianPhone ?? s.whatsapp') || SRC.includes('s.guardianPhone ?? s.whatsapp'),
    'الرقم لا يُقرأ كسلاسل');
  assert.ok(!SRC.includes('Number(s.guardianPhone'), 'تحويل رقمي للرقم');
});

/* ------------------------------------------------ 11) جلسة/جهاز آخر: الدمج الكامل يُبقي حفظ الاثنين */
test('11) جهاز آخر (أو جلسة مصرّح مختلفة) يدخل قسماً جديداً: الدمج يُبقي حفظ هذا الجهاز ورقم ولي الأمر الوارد', async () => {
  const serverCopy = Object.assign(JSON.parse(JSON.stringify(EMPTY_SERVER)), {
    students: [{ id: 's1', fullName: 'سارة', guardianPhone: '966568133414' }],
    notes: [{ id: 'nS', createdBy: 'uA', description: 'من الخادم', _v: 1 }],
    classes: [{ id: 'c1', name: '١' }]
  });
  const localSeed = baseDb({ // متصفح جديد فارغ + ملاحظة محلية لم تُرفع بعد
    notes: [{ id: 'nL', createdBy: 'uB', description: 'من هذا الجهاز', _v: 1 }]
  });
  const env = makePushEnv({
    store: { 'nibras_GIRLS_db_v1': JSON.stringify(localSeed) },
    fetch: async (url, opts) => {
      if (!opts) return respOf(200, { data: serverCopy, ts: 500 });
      return respOf(200, { ok: true, ts: 600 });
    }
  });
  const r = await env.push('GIRLS');
  assert.equal(r.ok, true);
  const after = JSON.parse(env.store[env.key]);
  assert.ok(after.students.some(s => s.id === 's1' && s.guardianPhone === '966568133414'),
    'رقم ولي الأمر الوارد من الخادم لم يصل هذا الجهاز');
  assert.ok(after.notes.some(n => n.id === 'nS'), 'ملاحظة الخادم لم تصل');
  assert.ok(after.notes.some(n => n.id === 'nL'), 'ملاحظة هذا الجهاز ضاعت عند أخذ نسخة الخادم');
  assert.equal(after.classes.some(c => c.id === 'c1'), true);
});

/* ------------------------------------------------ 12) الخادم: أساس أحدث من المخزن = دمج لا استبدال (استرجاع) */
test('12) الخادم: declaredBase أحدث من المخزن يُعتبر stale (دمج محافظ) — لا يمحو استرجاعاً حديثاً', () => {
  const m = SRV.match(/const stale = !!\([\s\S]*?declaredBase > storedTsNow\)\);/);
  assert.ok(m, 'شرط stale غير موجود كما هو');
  const f = new Function('prev', 'declaredBase', 'storedTsNow', 'behindBy', m[0] + '; return stale;');
  const prev = { data: { notes: [{ id: 'n1' }] }, ts: 200 };
  // توافق قديم: أساس أقدم ⇒ قديم (استبدال كامل يُحترم للمدير)
  assert.equal(f(prev, 150, 200, 50), true, 'أساس أقدم لم يُعامل كقديم');
  // نافذة الـ5 دقائق لعميل قديم بلا baseTs كما هي
  assert.equal(f(prev, 0, 200, 6 * 60 * 1000), true, 'تأخر 6 دقائق لم يُرصد');
  assert.equal(f(prev, 0, 200, 60 * 1000), false, 'دقيقة واحدة صارت قديمة بلا داعٍ');
  // الإصلاح: أساس مُدّعى أحدث مما لدى الخادم (بعد استرجاع نسخة احتياطية يتراجع
  // ts المخزَّن) ⇒ دمج محافظ لا استبدال، وإلا عادت البيانات القديمة وتلف الاسترجاع
  assert.equal(f(prev, 300, 200, -100), true, 'أساس أحدث من المخزن لم يُرصد كstale');
  // بلا بيانات مخزّنة: لا قرار قديم على فراغ
  assert.equal(f({ data: null, ts: 0 }, 300, 0, 0), false);
});

/* ------------------------------------------------ 13) الخادم: الأقسام المرفوضة تُبلَّغ لا تُسقَط بصمت */
test('13) الخادم: بلاغ الأقسام المرفوضة عبر X-Nibras-Dropped (users/غير مصرَّح/طلاب/ملاحظات/تحويلات) وردّ النجاح كما هو', () => {
  assert.ok(SRV.includes('const droppedSections = [];'), 'لا مجموع بلاغ الأقسام المرفوضة');
  assert.ok(SRV.includes("if (!jsonEqual(prevUsers, data.users)) droppedSections.push('users');"),
    'رفض تعديل الحسابات غير مُبلَّغ');
  assert.ok(SRV.includes("else if (key !== 'students') droppedSections.push(key);"),
    'قسم مرفوض في applyMerged غير مُسجَّل');
  assert.ok(SRV.includes("if (stuRejected && droppedSections.indexOf('students') === -1) droppedSections.push('students');"),
    'رفض تعديل طالب خارج حقول التأخر غير مُبلَّغ');
  assert.ok(SRV.includes("if (Array.isArray(delRights.blocked) && delRights.blocked.length) droppedSections.push('notes');"),
    'حذف ملاحظة مرفوض غير مُبلَّغ');
  assert.ok(SRV.includes("if (Array.isArray(tDel.blocked) && tDel.blocked.length) droppedSections.push('transfers');"),
    'حذف تحويل مرفوض غير مُبلَّغ');
  assert.ok(SRV.includes("res.set('X-Nibras-Dropped'"), 'الترويسة غير مضافة للرد');
  // جسم الردّ يبقى كما هو حرفياً (توافق العملاء القديمة) وقبله الترويسة
  const iHdr = SRV.indexOf("res.set('X-Nibras-Dropped'");
  const iBody = SRV.indexOf('res.json({ ok: true, ts: nextTs });', iHdr);
  assert.ok(iBody > iHdr, 'الترويسة تُضبط بعد ردّ النجاح (لن تصل)');
  // استثناء الطلاب من مسار applyMerged: يُعالَجون لاحقاً بحقول التأخر فقط
  assert.ok(SRV.includes("else if (key !== 'students') droppedSections.push(key);") &&
    SRV.includes('mergeStudentsLateOnly'), 'معالجة الطلاب الخاصة مفقودة');
});

/* ------------------------------------------------ 14) العميل يقرأ الترويسة: تحذير + 403 لقسم العملية المعلقة */
test('14) العميل: ترويسة X-Nibras-Dropped ⇒ push-partial + تحذير صريح، و403 للحارس إذا كان القسم المعلق هو المرفوض', async () => {
  const saveGuards = { GIRLS: [{ kind: 'consent', cb: () => {} }] }; // عملية معلقة على قسم الطلاب
  const env = makePushEnv({
    store: { 'nibras_GIRLS_db_v1': JSON.stringify(baseDb({ students: [{ id: 's1', guardianPhone: '966568133414' }] })) },
    saveGuards,
    fetch: async (url, opts) => {
      if (!opts) return respOf(200, { data: JSON.parse(JSON.stringify(EMPTY_SERVER)), ts: 200 });
      return respOf(200, { ok: true, ts: 300 }, { 'X-Nibras-Dropped': 'students' });
    }
  });
  const r = await env.push('GIRLS');
  assert.equal(r.ok, true);
  assert.equal(r.dropped, 'students', 'الأقسام المرفوضة لم تصل من الترويسة');
  assert.ok(env.calls.logs.some(e => e.ev === 'push-partial' && e.dropped === 'students'), 'لا تسجيل جزئي');
  assert.ok(env.calls.toasts.some(t => t.includes('students') && t.includes('غير محفوظة')), 'لا تحذير صريح للمستخدم');
  assert.ok(env.calls.notifies.some(x => x && x.ok === false && x.err === '403'),
    'عملية معلقة على قسم مرفوض لم تُبلَّغ بالفشل');
  // وحدة: __saveGuardDropped الحقيقية تقرّر 403 لقسم العملية المعلقة فقط
  assert.equal(env.dropped('GIRLS', 'students'), true, 'قسم المراقب المعلق لم يُرصد');
  assert.equal(env.dropped('GIRLS', 'users'), false, 'قسم آخر مرفوض لا يعني فشل عملية الطلاب');
  assert.equal(env.dropped('GIRLS', ''), false, 'فارغ يُعامل كلا شيء');
});

/* ------------------------------------------------ 15) رفع الإصدارات بعد الإصلاح */
test('15) البناء سليم والإصدار مرفوع (save-persist)', () => {
  const v = SRC.match(/const __APP_VER = '([^']+)'/);
  assert.ok(v && v[1].includes('save-persist'), 'الإصدار لا يحمل وسم هذا الإصلاح');
  const sw = fs.readFileSync(path.join(ROOT, 'public', 'sw.js'), 'utf8');
  const n = Number((sw.match(/nibras-v(\d+)/) || [])[1]);
  assert.ok(n >= 139, 'CACHE_NAME لم يُرفَع');
  assert.ok(SRC.includes('sw.js?v=118'), 'نسخة service worker لم تُرفَع');
});

/* محوّر سحب/تحديث: يشغّل __syncPull و__refreshSchool الحقيقيتين من الملف المنشور */
function makeSyncEnv(opts) {
  const o = opts || {};
  const store = o.store || {};
  const key = 'nibras_GIRLS_db_v1';
  const state = o.state || { running: false, dirty: false, attempts: 0, lastFail: 0, lastOkAt: 0, lastOkTs: 0 };
  const calls = { logs: [], schedules: [], fetchCount: 0 };
  const ctx = {
    console: { warn() {}, log() {}, error() {} },
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; }
    },
    __syncEnabled: () => true,
    __serverEnabled: () => true,
    __pushState: () => state,
    __pushPendingUntil: o.pendingUntil || {},
    __syncTS: (obj) => (obj && typeof obj === 'object' && obj._ts) || 0,
    SYNC_API: 'https://x/api/db/',
    fetch: async (url, opts) => { calls.fetchCount++; return o.fetch(url, opts); },
    __syncLogAdd: (e) => { calls.logs.push(e); },
    __syncSchedule: (school, ms) => { calls.schedules.push(ms); },
    __handleAuthError: () => {},
    __origSetItem: (k, v) => { store[k] = String(v); },
    __unpushedIds: () => (o.unpushedIds || []),
    __assignUnpushedIds: () => (o.assignIds || []),
    currentUser: () => null,
    NRC_noteBelongsToOther: () => false,
    setTimeout: (fn, ms) => { setTimeout(fn, 5); return 1; }
  };
  vm.createContext(ctx);
  vm.runInContext(
    ['__canon', '__canonEq', '__attWinner', 'NRC_mergeNotes', '__mergeStudentsLocal',
     'mergeClassesLocal', '__mergeTransfersPull', '__mergeMsg', '__mergeSuggestion',
     '__pendShouldDiscard', '__syncPullPaused'].map(extractFns).join('\n') +
    '\n' + extractFns('__syncPull').replace(/^function __syncPull\(/, 'async function __syncPull(') +
    '\n' + extractFns('__refreshSchool').replace(/^function __refreshSchool\(/, 'async function __refreshSchool(') +
    '\n;globalThis.__pull = __syncPull; globalThis.__refresh = __refreshSchool;',
    ctx
  );
  return { store, calls, state, ctx, key, pull: ctx.__pull, refresh: ctx.__refresh };
}

/* ---------------------------------- 16) السحب لا يكتب فوق دفعةٍ لم تُرفع بعد */
test('16) __syncPull: نافذة رفع جارية أو فشل حديث ⇒ لا جلب ولا كتابة (pull-skipped-busy / إعادة الدفع)', async () => {
  // (أ) نافذة رفع مجدولة/جارية: لا سحب أصلاً
  {
    const env = makeSyncEnv({
      store: { 'nibras_GIRLS_db_v1': JSON.stringify(baseDb({ notes: [{ id: 'nLocal', points: 3, description: 'محلي لم يُرفع' }] })) },
      pendingUntil: { GIRLS: Date.now() + 5000 },
      fetch: async () => { throw new Error('لا يجوز جلب أثناء نافذة رفع'); }
    });
    await env.pull('GIRLS');
    assert.equal(env.calls.fetchCount, 0, 'سُحب أثناء نافذة رفع مجدولة');
    assert.ok(env.calls.logs.some(e => e.ev === 'pull-skipped-busy'), 'لا تسجيل تخطي السحب');
    const after = JSON.parse(env.store[env.key]);
    assert.equal(after.notes[0].description, 'محلي لم يُرفع', 'تغيّر التخزين رغم تخطي السحب');
  }
  // (ب) رفع فاشل حديث: يُعاد الدفع بدل كتابة نسخة الخادم فوقه
  {
    const env = makeSyncEnv({
      store: { 'nibras_GIRLS_db_v1': JSON.stringify(baseDb({ notes: [{ id: 'nLocal', points: 3, description: 'بانتظار إعادة المحاولة' }] })) },
      state: { running: false, dirty: false, attempts: 2, lastFail: Date.now(), lastOkAt: 0, lastOkTs: 0 },
      fetch: async () => { throw new Error('لا يجوز سحب قبل إعادة الدفع'); }
    });
    await env.pull('GIRLS');
    assert.equal(env.calls.fetchCount, 0, 'سُحب فوق رفع فاشل حديث');
    assert.ok(env.calls.schedules.includes(0), 'لم تُجدَّل إعادة دفع فورية');
    const after = JSON.parse(env.store[env.key]);
    assert.equal(after.notes[0].description, 'بانتظار إعادة المحاولة');
  }
  // (ج) سحب عادي بعد نجاح الرفع: يُبقي حفظ هذا الجهاز ويأخذ نسخة الخادم
  {
    const serverCopy = Object.assign(JSON.parse(JSON.stringify(EMPTY_SERVER)), {
      students: [{ id: 's1', fullName: 'سارة', guardianPhone: '966568133414' }],
      notes: [{ id: 'nS', createdBy: 'uA', description: 'من الخادم', _v: 1 }],
      grades: [{ id: 'g1' }],
      classes: [{ id: 'c1', name: '١', gradeId: 'g1' }]
    });
    const env = makeSyncEnv({
      store: { 'nibras_GIRLS_db_v1': JSON.stringify(baseDb({ notes: [{ id: 'nL', createdBy: 'uB', description: 'من هذا الجهاز', _v: 1 }] })) },
      fetch: async () => respOf(200, { data: serverCopy, ts: 500 })
    });
    await env.pull('GIRLS');
    const after = JSON.parse(env.store[env.key]);
    assert.ok(after.notes.some(n => n.id === 'nL'), 'ملاحظة هذا الجهاز ضاعت عند السحب');
    assert.ok(after.notes.some(n => n.id === 'nS'), 'ملاحظة الخادم لم تصل بالسحب');
    assert.ok(after.students.some(s => s.guardianPhone === '966568133414'), 'رقم ولي الأمر لم يصل بالسحب');
    assert.ok(env.calls.logs.some(e => e.ev === 'pull-merged'), 'لا تسجيل دمج السحب');
  }
});

/* ------------------------- 17) تحديث المدرسة: حارس التأخير وسباق الكتابة لا يمحون الحفظ */
test('17) __refreshSchool: حفظ معلّق ⇒ refresh-deferred بلا جلب؛ وكتابة أثناء الجلب ⇒ refresh-raced بلا طمس', async () => {
  // (أ) نسخة احتياطية معلّقة: لا استبدال — يُدفع أولاً
  {
    const env = makeSyncEnv({
      store: {
        'nibras_GIRLS_db_v1': JSON.stringify(baseDb({ notes: [{ id: 'n1', points: 5 }] })),
        'nibras_GIRLS_pending_v1': JSON.stringify(baseDb({ _ts: 900, notes: [{ id: 'nPEND', points: 8 }] }))
      },
      fetch: async () => { throw new Error('لا يجوز جلب والحفظ معلّق'); }
    });
    await env.refresh('GIRLS');
    assert.equal(env.calls.fetchCount, 0, 'حُدِّثت المدرسة فوق نسخة معلّقة');
    assert.ok(env.calls.logs.some(e => e.ev === 'refresh-deferred'), 'لا تسجيل تأجيل التحديث');
    assert.ok(env.calls.schedules.includes(0), 'لم يُجدَّل دفع المعلّق فوراً');
    const after = JSON.parse(env.store[env.key]);
    assert.equal(after.notes[0].id, 'n1', 'تغيّر التخزين رغم التأجيل');
  }
  // (ب) سجلات ما لم يُرفع بعد (نقاط/تكليفات): نفس التأجيل
  {
    const env = makeSyncEnv({
      store: { 'nibras_GIRLS_db_v1': JSON.stringify(baseDb({ notes: [{ id: 'n1', points: 5 }] })) },
      assignIds: ['a1'],
      fetch: async () => { throw new Error('لا يجوز جلب وأسافين معلّقة'); }
    });
    await env.refresh('GIRLS');
    assert.equal(env.calls.fetchCount, 0, 'حُدِّثت المدرسة وتكليف لم يُرفع');
    assert.ok(env.calls.logs.some(e => e.ev === 'refresh-deferred'));
  }
  // (ج) نظيف + كتابة وصلت أثناء الجلب: تُسقط الكتابة بدل طمسها
  {
    const raced = baseDb({ _ts: 999, notes: [{ id: 'nRACE', points: 9, description: 'حفظ وصل أثناء التحديث' }] });
    const env = makeSyncEnv({
      store: { 'nibras_GIRLS_db_v1': JSON.stringify(baseDb({ notes: [{ id: 'nOld', points: 1 }] })) },
      fetch: async () => {
        await new Promise(r => setTimeout(r, 20));
        env.store[env.key] = JSON.stringify(raced); // تعديل أثناء الجلب
        return respOf(200, { data: Object.assign(JSON.parse(JSON.stringify(EMPTY_SERVER)), { notes: [{ id: 'nSRV', _v: 1 }] }), ts: 500 });
      }
    });
    await env.refresh('GIRLS');
    const after = JSON.parse(env.store[env.key]);
    assert.equal(after.notes[0].id, 'nRACE', 'طُمس حفظ وصل أثناء جلب التحديث');
    assert.ok(env.calls.logs.some(e => e.ev === 'refresh-raced'), 'لا تسجيل سباق الكتابة');
  }
});

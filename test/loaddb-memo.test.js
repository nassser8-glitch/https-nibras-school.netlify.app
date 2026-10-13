'use strict';
// Regression: بطء فتح صفحة «الملاحظات».
//
// الجذر: loadDB() يقرأ التخزين ويحلّل JSON ويُجري تنظيفات على آلاف السجلات. وكانت
// أدوات البحث (studentById/userById/currentUser/studentPointsMap/nibrasPioneerData)
// تستدعي loadDB() مرةً لكل صفّ في الجدول، وNRC_noteHasPendingClaim تستدعي
// NRC_pendingClaimIds() (قراءة+تحليل localStorage) مرةً لكل ملاحظة في قوائم
// «الاسترداد» — فيُفتح الجدول ببطء شديد عند الجميع.
//
// الحل: كاش قراءة في loadDB يُبطَل تلقائياً حين يتغيّر نصّ التخزين، وكاش في
// NRC_pendingClaimIds. الاختبار يحمّل الدوال في vm بسياق مُموّه ويتحقّق أن الكاش
// يعمل ويُبطَل صحيحاً بلا أن يُخفي تغييرات التخزين.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

function extractFn(marker) {
  const startIdx = SRC.indexOf('function ' + marker + '(');
  if (startIdx === -1) throw new Error('function not found in index.html: ' + marker);
  const openBrace = SRC.indexOf('{', startIdx);
  let depth = 0, i = openBrace;
  for (; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}') { depth--; if (depth === 0) break; }
  }
  return SRC.slice(startIdx, i + 1);
}

function makeStorage() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
    _m: m,
  };
}

function makeCtx() {
  const localStorage = makeStorage();
  const ctx = vm.createContext({
    Math, JSON, Object, Array, Set, Map, String, Number, Date, isFinite, console,
    localStorage,
    window: {},
    DEMO_MODE: false,
    __serverEnabled: () => false,
    dbKey: () => 'nibras_GIRLS_db_v1',
    getActiveSchool: () => 'GIRLS',
    NOTE_PENDING_KEY: s => 'nibras_notepending_' + s + '_v1',
    isSchoolDay: () => true,
    seedDB: () => ({ users: [], grades: [], classes: [], students: [], attendance: [], notes: [], transfers: [], maintenance: [], adminMsgs: [], announcements: [], suggestions: [] }),
  });
  for (const fn of ['__canon', '__canonNoTs', 'saveDB', 'loadDB', 'NRC_pendingClaimIds']) {
    vm.runInContext(extractFn(fn), ctx);
  }
  // تصاريح الكاش (في المصدر تقع قبل loadDB خارج جسم الدالة)
  vm.runInContext('let __dbMemoRaw = null, __dbMemoObj = null; let __npcRaw = null, __npcSet = null;', ctx);
  return { ctx, localStorage };
}

test('loadDB: نداءان متتاليان بلا تغيير التخزين يعيدان نفس الكائن (كاش قراءة)', () => {
  const { ctx } = makeCtx();
  const loadDB = vm.runInContext('loadDB', ctx);
  const a = loadDB();
  assert.ok(a && Array.isArray(a.notes) && Array.isArray(a.students), 'يُبنى كائن قاعدة صالح');
  const b = loadDB();
  assert.equal(a, b, 'بلا تغيير نصّ التخزين → نفس المرجع (لا إعادة تحليل ولا تنظيفات)');
});

test('loadDB: تغيّر نصّ التخزين externally يُبطل الكاش فيُعاد التحليل', () => {
  const { ctx, localStorage } = makeCtx();
  const loadDB = vm.runInContext('loadDB', ctx);
  const a = loadDB();
  // كتابة خارجية (كما يفعل __syncPush عبر __origSetItem) تُغيّر النصّ دون المرور بالكاش
  localStorage.setItem('nibras_GIRLS_db_v1', JSON.stringify({
    users: [], grades: [], classes: [], students: [], attendance: [],
    notes: [{ id: 'n1', studentId: 's1', type: 'POSITIVE', category: 'تعاون', createdBy: 'u1', createdAt: 1 }],
    transfers: [], maintenance: [], adminMsgs: [], announcements: [], suggestions: [],
  }));
  const c = loadDB();
  assert.notEqual(c, a, 'تغيّر النصّ → كائن جديد');
  assert.equal(c.notes.length, 1, 'الكائن الجديد يعكس الكتابة الخارجية');
});

test('loadDB: saveDB يُحدّث الكاش فيرى النداء التالي الحفظ فوراً', () => {
  const { ctx } = makeCtx();
  const loadDB = vm.runInContext('loadDB', ctx);
  const a = loadDB();
  a.students.push({ id: 's9', fullName: 'طالبة' });
  vm.runInContext('saveDB', ctx)(a);
  const b = loadDB();
  assert.equal(b, a, 'بعد الحفظ يعيد loadDB نفس الكائن المحفوظ');
  assert.equal(b.students.length, 1, 'الحفظ ظاهر بلا انتظار');
});

test('loadDB: تنظيفات قاعدة البيانات ما زالت تعمل مرة واحدة (حذف حضور مكرر)', () => {
  const { ctx, localStorage } = makeCtx();
  const loadDB = vm.runInContext('loadDB', ctx);
  localStorage.setItem('nibras_GIRLS_db_v1', JSON.stringify({
    users: [], grades: [], classes: [], students: [],
    attendance: [
      { studentId: 's1', date: '2026-01-01', status: 'PRESENT' },
      { studentId: 's1', date: '2026-01-01', status: 'ABSENT' },
    ],
    notes: [], transfers: [], maintenance: [], adminMsgs: [], announcements: [], suggestions: [],
  }));
  const d = loadDB();
  assert.equal(d.attendance.length, 1, 'السجل المكرر لليوم نفسه يُدمج إلى واحد');
});

test('NRC_pendingClaimIds: كاش المُعرّفات يُبطَل عند الكتابة', () => {
  const { ctx, localStorage } = makeCtx();
  const npc = vm.runInContext('NRC_pendingClaimIds', ctx);
  const s1 = npc();
  const s2 = npc();
  assert.equal(s1, s2, 'لا تغيير → نفس كائن الـSet (لا إعادة قراءة/تحليل لكل ملاحظة)');
  assert.equal(s1.size, 0);
  localStorage.setItem('nibras_notepending_GIRLS_v1', JSON.stringify(['n1', 'n2']));
  const s3 = npc();
  assert.notEqual(s3, s1, 'تغيّر التخزين → إعادة الحساب');
  assert.ok(s3.has('n1') && s3.has('n2'), 'القيم الجديدة ظاهرة');
});

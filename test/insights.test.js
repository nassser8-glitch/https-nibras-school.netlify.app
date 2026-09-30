// اختبارات قسم «نبراس يرى»: الغياب المتكرر والتحويلات المتكررة
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const INDEX = path.join(__dirname, '..', 'public', 'index.html');
const src = fs.readFileSync(INDEX, 'utf8');

// ن extract الكود من index.html: الثوابت + الدالتان + دالة longestRun المغلقة
function extractBlock(name, from, to){
  const s = src.indexOf(from);
  const e = src.indexOf(to, s);
  assert.ok(s !== -1, `لم يُعثر على بداية ${name}`);
  assert.ok(e > s, `لم يُعثر على نهاية ${name}`);
  return src.slice(s, e);
}

function extractInsightsCode(){
  const optConsts = extractBlock('ثوابت المؤشرات', 'const __insightAbsOpts', 'function __insightRepeatedAbsence');
  const absFn = extractBlock('__insightRepeatedAbsence', 'function __insightRepeatedAbsence', 'function __insightFrequentTransfers');
  const trFn  = extractBlock('__insightFrequentTransfers', 'function __insightFrequentTransfers', 'function __insightModal');
  return optConsts + '\n' + absFn + '\n' + trFn;
}

const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

function sandbox(db){
  const context = {
    console,
    Date,
    Number,
    Set,
    Map,
    Object,
    Array,
    Math,
    __db: db,
    loadDB: () => db,
    // نسخة مبسّطة من القاعدة الفعلية: الغائب/المتأخر يفوز، وdeleted يُهمَل
    __attIsAbsent: (r) => !!(r && r.status === 'ABSENT'),
    __attEffStatus: (rec) => {
      if(!rec) return 'PRESENT';
      if(rec.deleted) return 'ABSENT';
      return rec.status === 'LATE' ? 'LATE' : (rec.status === 'ABSENT' ? 'ABSENT' : 'PRESENT');
    },
    classLabel: (c) => `${c ? c.name : '?'}`,
  };
  vm.createContext(context);
  vm.runInContext(extractInsightsCode() + '\n;globalThis.__r = __insightRepeatedAbsence; globalThis.__f = __insightFrequentTransfers;', context);
  return { abs: (...a) => context.__r(...a), freq: (...a) => context.__f(...a) };
}

// يبني سجل حضور: studentId -> عدد أيام غياب متتالية ابتداءً من اليوم
function attendanceRun(studentId, count, offsetDays = 0){
  const out = [];
  for(let i = 0; i < count; i++){
    out.push({ id:`A-${studentId}-${i}`, studentId, date: iso(Date.now() - (offsetDays + i) * DAY), status:'ABSENT' });
  }
  return out;
}

function mkStudent(id, name, classId){
  return { id, fullName:name, classId, active:true };
}

// ===== الغياب المتكرر =====

test('غياب 9 أيام متفرقة لا يُعدّ غيابًا متكررًا (تحت العتبة)', () => {
  const s1 = mkStudent('S1', 'طالب واحد', 'C1');
  const db = { students:[s1], classes:[{id:'C1', name:'أ'}], attendance: attendanceRun('S1', 9).map((a,i) => ({...a, date: iso(Date.now() - (i*2) * DAY)})), transfers:[] };
  const { abs } = sandbox(db);
  assert.equal(abs().length, 0, '9 أيام متفرقة أقل من 10 — لا يظهر');
});

test('غياب 10 أيام في آخر 30 يومًا يُظهر الطالب', () => {
  const s1 = mkStudent('S1', 'طالب متكرر', 'C1');
  const db = { students:[s1], classes:[{id:'C1', name:'أ'}], attendance: attendanceRun('S1', 10), transfers:[] };
  const { abs } = sandbox(db);
  const rows = abs();
  assert.equal(rows.length, 1, 'يجب أن يظهر طالب واحد');
  assert.equal(rows[0].total, 10);
  assert.equal(rows[0].run, 10, '10 أيام متتالية = سلسلة 10');
});

test('5 أيام متتالية فقط تكفي (أقل من 10 أيام إجمالًا)', () => {
  const s1 = mkStudent('S1', 'طالب متتالٍ', 'C1');
  const db = { students:[s1], classes:[{id:'C1', name:'أ'}], attendance: attendanceRun('S1', 5), transfers:[] };
  const { abs } = sandbox(db);
  const rows = abs();
  assert.equal(rows.length, 1, 'السلسلة المتتالية 5 أيام تكفي للظهور');
  assert.equal(rows[0].total, 5);
  assert.equal(rows[0].run, 5);
});

test('4 أيام متتالية + 3 متباعدة = لا ظهور (دون 5 متتالية ودون 10 إجمالًا)', () => {
  const s1 = mkStudent('S1', 'طالب متوسط', 'C1');
  const dates = [0,1,2,3, 10, 20, 21].map(n => iso(Date.now() - n * DAY)); // 4 متتالية + 3 متباعدة = 7
  const db = { students:[s1], classes:[{id:'C1', name:'أ'}],
    attendance: dates.map((dte,i) => ({id:`A${i}`, studentId:'S1', date:dte, status:'ABSENT'})), transfers:[] };
  const { abs } = sandbox(db);
  assert.equal(abs().length, 0, '7 أيام إجمالًا و4 متتالية: لا يستوفي شرط 10 ولا شرط 5 متتالية');
});

test('4 أيام متتالية + 6 متباعدة (10 إجمالًا) تظهر بسبب العدد لا التسلسل', () => {
  const s1 = mkStudent('S1', 'طالب عشرون', 'C1');
  const dates = [0,1,2,3, 10, 14, 18, 22, 25, 27].map(n => iso(Date.now() - n * DAY)); // 10 أيام، أطول سلسلة 4
  const db = { students:[s1], classes:[{id:'C1', name:'أ'}],
    attendance: dates.map((dte,i) => ({id:`A${i}`, studentId:'S1', date:dte, status:'ABSENT'})), transfers:[] };
  const { abs } = sandbox(db);
  const rows = abs();
  assert.equal(rows.length, 1, '10 أيام إجمالًا تكفي ولو لم تكن متتالية');
  assert.equal(rows[0].total, 10);
  assert.equal(rows[0].run, 4, 'أطول سلسلة 4 فقط');
});

test('غياب خارج نافذة 30 يومًا لا يُحتسب', () => {
  const s1 = mkStudent('S1', 'طالب قديم', 'C1');
  const old = attendanceRun('S1', 15, 40); // كله أقدم من 40 يومًا
  const db = { students:[s1], classes:[{id:'C1', name:'أ'}], attendance: old, transfers:[] };
  const { abs } = sandbox(db);
  assert.equal(abs().length, 0, 'لا يُحتسب غياب أقدم من 30 يومًا');
});

test('سجلّان لنفس الطالب في نفس اليوم لا يُضاعفان العدّ', () => {
  const s1 = mkStudent('S1', 'مكرر السجل', 'C1');
  const dte = iso(Date.now());
  const db = { students:[s1], classes:[{id:'C1', name:'أ'}],
    attendance: Array.from({length:12}, (_,i) => ({id:`A${i}`, studentId:'S1', date:i%2 ? dte : iso(Date.now() - (Math.floor(i/2)) * DAY), status:'ABSENT'})), transfers:[] };
  const { abs } = sandbox(db);
  const rows = abs();
  assert.equal(rows[0].total, 6, 'اليوم مكرّر مرتين فيجب أن يُحسب مرة واحدة (6 أيام فريدة، لا 12)');
});

test('طالب غير نشط أو غير موجود لا يظهر في الغياب المتكرر', () => {
  const db = { students:[], classes:[],
    attendance: attendanceRun('GONE', 12), transfers:[] };
  const { abs } = sandbox(db);
  assert.equal(abs().length, 0, 'لا يظهر طالب غير مسجّل');
});

test('سجلّ محذوف (deleted) يُتجاهل في عدّ الغياب', () => {
  const s1 = mkStudent('S1', 'طالب', 'C1');
  const att = attendanceRun('S1', 12).map((a,i) => i < 6 ? {...a, deleted:true} : a);
  const db = { students:[s1], classes:[{id:'C1', name:'أ'}], attendance: att, transfers:[] };
  const { abs } = sandbox(db);
  const rows = abs();
  assert.equal(rows[0].total, 6, '6 أيام غير محذوفة فقط');
});

// ===== التحويلات المتكررة =====

test('أكثر من 3 تحويلات لنفس الطالب تظهر (4 تحويلات)', () => {
  const s1 = mkStudent('S1', 'متحوّل كثير', 'C1');
  const transfers = [1,2,3,4].map(n => ({ id:`T${n}`, studentIds:['S1'], target:'COUNSELOR', createdAt: iso(Date.now()) }));
  const db = { students:[s1], classes:[{id:'C1', name:'أ'}], attendance:[], transfers };
  const { freq } = sandbox(db);
  const rows = freq();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].n, 4);
});

test('3 تحويلات بالضبط لا تظهر (العتبة أكثر من 3)', () => {
  const s1 = mkStudent('S1', 'ثلاثة تحويلات', 'C1');
  const transfers = [1,2,3].map(n => ({ id:`T${n}`, studentIds:['S1'], createdAt: iso(Date.now()) }));
  const db = { students:[s1], classes:[{id:'C1', name:'أ'}], attendance:[], transfers };
  const { freq } = sandbox(db);
  assert.equal(freq().length, 0, '3 لا تكفي — العتبة «أكثر من 3»');
});

test('تحويل بحقل studentId القديم (لا studentIds) يُحتسب', () => {
  const s1 = mkStudent('S1', 'قديم الحقل', 'C1');
  const transfers = [1,2,3,4,5].map(n => ({ id:`T${n}`, studentId:'S1', createdAt: iso(Date.now()) }));
  const db = { students:[s1], classes:[{id:'C1', name:'أ'}], attendance:[], transfers };
  const { freq } = sandbox(db);
  assert.equal(freq()[0].n, 5, 'studentId القديم مدعوم');
});

test('تحويل محذوف (deleted) لا يُحتسب', () => {
  const s1 = mkStudent('S1', 'تحويلات محذوفة', 'C1');
  const transfers = [1,2,3,4,5,6].map(n => ({ id:`T${n}`, studentId:'S1', deleted: n<=4, createdAt: iso(Date.now()) }));
  const db = { students:[s1], classes:[{id:'C1', name:'أ'}], attendance:[], transfers };
  const { freq } = sandbox(db);
  assert.equal(freq().length, 0, '6 تحويلات منها 4 محذوفة = 2 فعّالة، لا تظهر');
});

test('تحويل يغطي عدة طلاب يُنسب لكل واحد', () => {
  const s1 = mkStudent('S1', 'طالب أ', 'C1');
  const s2 = mkStudent('S2', 'طالب ب', 'C1');
  const transfers = [1,2,3,4].map(n => ({ id:`T${n}`, studentIds:['S1','S2'], createdAt: iso(Date.now()) }));
  const db = { students:[s1, s2], classes:[{id:'C1', name:'أ'}], attendance:[], transfers };
  const { freq } = sandbox(db);
  assert.equal(freq().length, 2, 'كل طالب عدّ 4 تحويلات');
});

test('الترتيب تنازلي بالأعلى عددًا', () => {
  const s1 = mkStudent('S1', 'قليل', 'C1');
  const s2 = mkStudent('S2', 'كثير جدًا', 'C1');
  const transfers = [
    { id:'T1', studentIds:['S1'] }, { id:'T2', studentIds:['S1'] },
    { id:'T3', studentIds:['S1'] }, { id:'T4', studentIds:['S1'] },
    { id:'T5', studentIds:['S2'] }, { id:'T6', studentIds:['S2'] },
    { id:'T7', studentIds:['S2'] }, { id:'T8', studentIds:['S2'] },
    { id:'T9', studentIds:['S2'] },
  ];
  const db = { students:[s1, s2], classes:[{id:'C1', name:'أ'}], attendance:[], transfers };
  const { freq } = sandbox(db);
  const rows = freq();
  assert.equal(rows.length, 2, 'كلاهما فوق العتبة (4 و5)');
  assert.equal(rows[0].id, 'S2', 'الأكثر تحويلات أولًا');
  assert.equal(rows[0].n, 5);
  assert.equal(rows[1].n, 4);
});

test('قاعدة بيانات فارغة لا تنهار', () => {
  const db = { students:[], classes:[], attendance:[], transfers:[] };
  const { abs, freq } = sandbox(db);
  assert.deepEqual(abs(), []);
  assert.deepEqual(freq(), []);
});

'use strict';
/* =============================================================================
 * بقاء رقم ولي الأمر عبر المزامنة
 * -----------------------------------------------------------------------------
 * القصة: الرقم يُكتب في الحقل الموحّد guardianPhone، ويجب أن يبقى بعد إعادة
 * فتح التطبيق. كان السحب يبني النسخة من الخادم ثم يُلحق فقط الطلاب الجدد،
 * فيسقط تعديل الجهاز على طالبة موجودة ويعود الرقم فارغاً. والإنجاز كان يرسل
 * الرقم إلى الخادم بلا حقله في الطلب. عولج: حقن الرقم في طلب الإنشاء، وختم
 * زمني للتعديل يرجّح الأحدث عند السحب، ودفع فوري بعد كل تعديل محلي.
 * ========================================================================== */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

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

function loadMerge() {
  const fn = extractFns('__mergeStudentsLocal');
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(fn + '\nM=__mergeStudentsLocal;', ctx);
  return ctx.M;
}

const norm = (v) => String(v ?? '').replace(/\D/g, '');

// ------------------------------------------------ 1) سحب لا يسقط الرقم
test('1) السحب يحفظ رقم ولي الأمر المحلي إن كان الخادم فارغاً', () => {
  const M = loadMerge();
  const srv = [{ id: 's1', fullName: 'أ', guardianPhone: '', active: true }];
  const loc = [{ id: 's1', fullName: 'أ', guardianPhone: '966500000000', guardianPhoneAt: 1000, active: true }];
  const out = M(loc, srv);
  assert.equal(out.length, 1, 'لا يُضاف تكرار');
  assert.equal(out[0].guardianPhone, '966500000000', 'الرقم المحلي ضاع في السحب');
});

test('2) طالبة موجودة محلياً وغير موجودة في الخادم تُلحق ولا تضيع', () => {
  const M = loadMerge();
  const srv = [{ id: 's1', fullName: 'أ' }];
  const loc = [{ id: 's1' }, { id: 's2', fullName: 'ب', guardianPhone: '966511111111' }];
  const out = M(loc, srv);
  assert.equal(out.length, 2, 'طالبة محلية جديدة ضاعت');
  const s2 = out.find(x => x.id === 's2');
  assert.equal(s2 && norm(s2.guardianPhone), '966511111111');
});

// ------------------------------------------------ 2) الختم الزمني يرجّح الأحدث
test('3) ختم زمني أحدث يفوز — تعديل الجهاز الأحدث يعلّق رقم الخادم', () => {
  const M = loadMerge();
  const srv = [{ id: 's1', guardianPhone: '966500000000', guardianPhoneAt: 1000 }];
  const loc = [{ id: 's1', guardianPhone: '966522222222', guardianPhoneAt: 2000 }];
  assert.equal(norm(M(loc, srv)[0].guardianPhone), '966522222222', 'الأخفق المحلي خسر رغم الأحدث');
});

test('4) ختم الخادم أحدث فيفوز — تعديل جهاز آخر لاحقاً يعلّق رقم هذا الجهاز', () => {
  const M = loadMerge();
  const srv = [{ id: 's1', guardianPhone: '966533333333', guardianPhoneAt: 5000 }];
  const loc = [{ id: 's1', guardianPhone: '966544444444', guardianPhoneAt: 2000 }];
  assert.equal(norm(M(loc, srv)[0].guardianPhone), '966533333333', 'رقم الأحدث الأقدم خسر');
});

// ------------------------------------------------ 3) الفراغ لا يمحو رقماً
test('5) جهاز بلا رقم لا يمحو رقماً محفوظاً عندما لا توجد أختام', () => {
  const M = loadMerge();
  const srv = [{ id: 's1', guardianPhone: '966555555555' }];
  const loc = [{ id: 's1' }]; // جهاز قديم لم يُحدّث هذا الحقل قط
  assert.equal(norm(M(loc, srv)[0].guardianPhone), '966555555555', 'رقم ضاع بسبب جهاز قديم');
});

test('6) الفراغ ينشر مع ختم أحدث (مسح الرقم يعمّم)', () => {
  const M = loadMerge();
  const srv = [{ id: 's1', guardianPhone: '966555555555', guardianPhoneAt: 1000 }];
  const loc = [{ id: 's1', guardianPhone: '', guardianPhoneAt: 9000 }];
  assert.equal(norm(M(loc, srv)[0].guardianPhone), '', 'المسح لم ينشر');
});

// ------------------------------------------------ 4) كل مسار كتابة يدفع
test('7) كل مسار كتابة يستدعي الدفع الفوري للخادم', () => {
  const add = extractFns('addStudent');
  assert.ok(add.includes('__syncSchedule('), 'إضافة طالبة لا تدفع');

  const edit = extractFns('editStudentPhone');
  assert.ok(edit.includes('__syncSchedule('), 'تعديل الرقم لا يدفع');
  assert.ok(edit.includes('saveDB('), 'تعديل الرقم لا يحفظ محلياً');
  assert.ok(edit.includes('guardianPhoneAt'), 'تعديل الرقم بلا ختم زمني');

  const idx = SRC.indexOf('function importStudents(');
  const body = SRC.slice(idx, idx + 4000);
  assert.ok(body.includes('__syncSchedule('), 'الاستيراد لا يدفع');
  assert.ok(body.includes('guardianPhoneAt'), 'الاستيراد بلا ختم زمني');
});

// ------------------------------------------------ 5) الرقم يصل الخادم مع الإنشاء
test('8) إنشاء طالبة يرسل الرقم للخادم ويستقبله الخادم', () => {
  const add = extractFns('addStudent');
  assert.ok(add.includes('guardianPhone: guardianPhone'), 'الطلب لا يحوي الرقم');

  const s = SERVER.indexOf("/api/auth/admin/create-student");
  assert.ok(s !== -1, 'وجهة إنشاء طالبة غير موجودة');
  const e = SERVER.indexOf('app.post(', s + 10);
  const ep = SERVER.slice(s, e === -1 ? s + 3000 : e);
  assert.ok(ep.includes('req.body.guardianPhone'), 'الخادم لا يقرأ الرقم من الطلب');
  assert.ok(ep.includes('guardianPhone: guardianPhone || '), 'الخادم لا يخزّن الرقم في السجل');
  assert.ok(ep.includes('guardianPhoneAt'), 'الخادم لا يختم التعديل زمنياً');
});

// ------------------------------------------------ 6) الخادم لا يحذف الحقل
test('9) سجل الطالبة في الخادم يحفظ الحقول كاملة بلا فلترة', () => {
  const db = fs.readFileSync(path.join(ROOT, 'db.js'), 'utf8');
  const m = db.match(/const student = Object\.assign\(\{\}, input\.student, \{ id \}\);/);
  assert.ok(m, 'db.js لا تبني السجل بالحقن — قد تُسقط الحقول الجديدة');
});

// ------------------------------------------------ 7) الخادم يحمي الرقم بختمه
function loadServerMerge() {
  const start = SERVER.indexOf('function mergeStudentGuardian(');
  assert.ok(start !== -1, 'mergeStudentGuardian غير موجود في الخادم');
  const open = SERVER.indexOf('{', start);
  let depth = 0, end = -1;
  for (let i = open; i < SERVER.length; i++) {
    if (SERVER[i] === '{') depth++;
    else if (SERVER[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(SERVER.slice(start, end) + '\nM=mergeStudentGuardian;', ctx);
  return ctx.M;
}

test('10) دفعة من جهاز قديم لا تمحو رقماً أحدث محفوظاً في الخادم', () => {
  const M = loadServerMerge();
  const prev = [{ id: 's1', guardianPhone: '966500000000', guardianPhoneAt: 9000 }];
  const inc  = [{ id: 's1', guardianPhone: '', guardianPhoneAt: 0 }]; // جهاز قديم بلا ختم
  const out = M(prev, inc);
  assert.equal(norm(out[0].guardianPhone), '966500000000', 'الرقم مُسح بنسخة أقدم');
  assert.equal(out[0].guardianPhoneAt, 9000, 'الختم الأحدث لم ينتقل');
});

test('11) تعديل أحدث يصل فيفوز — وسجل جديد بلا مقابل يبقى كما هو', () => {
  const M = loadServerMerge();
  const prev = [{ id: 's1', guardianPhone: '966500000000', guardianPhoneAt: 9000 }];
  assert.equal(norm(M(prev, [{ id: 's1', guardianPhone: '966511111111', guardianPhoneAt: 9500 }])[0].guardianPhone),
    '966511111111', 'الأخفق الأحدث خسر');
  const fresh = M(prev, [{ id: 's2', guardianPhone: '966522222222', guardianPhoneAt: 1 }]);
  assert.equal(norm(fresh.find(s => s.id === 's2').guardianPhone), '966522222222', 'طالبة جديدة ضاعت');
});

test('12) مسار الحفظ يستدعي الحماية في الاستبدال الكامل وفي الدمج', () => {
  const push = SERVER.slice(SERVER.indexOf('const applyMerged ='));
  assert.ok(push.includes('mergeStudentGuardian('), 'applyMerged لا يستدعي الحماية');
  assert.ok(/cf\.students = mergeStudentGuardian\(/.test(push), 'الاستبدال الكامل لا يستدعي الحماية');
  assert.ok((push.match(/mergeStudentGuardian\(/g) || []).length >= 2, 'المساران غير مغطّيان');
});

// ------------------------------------------------ 8) الرفع لا يُسقط تعديل الرقم
test('13) دمج الرفع يستعمل حماية الرقم للطلاب (لا locallyOnly)', () => {
  const push = SRC.slice(SRC.indexOf('async function __syncPush('), SRC.indexOf('async function __syncPull('));
  assert.ok(push.includes("__mergeStudentsLocal(obj[sec], sd[sec])"),
    'الرفع لا يستعمل __mergeStudentsLocal للطلاب — تعديل البطاقة يضيع');
  // نفس مسار الطلاب في الرفع يجب ألّا يقع في locallyOnly (يُلحق الجديد فقط ويسقط التعديل)
  const line = push.split('\n').find(l => l.includes("sec === 'students'"));
  assert.ok(line && line.includes('__mergeStudentsLocal'), 'فرع الطلاب في الرفع لا يحمي الرقم');
});

test('14) سجل سبق رفعه: تعديل الرقم محلياً يتقدّم على نسخة الخادم الفارغة عند الرفع', () => {
  const M = loadMerge();
  // obj المحلي (كما يبنيه __syncPush) يقابل الخادم sd في __mergeStudentsLocal(obj, sd)
  const srv = [{ id: 's1', fullName: 'ترف ناصر', guardianPhone: '', active: true }];
  const loc = [{ id: 's1', fullName: 'ترف ناصر', guardianPhone: '966568133414', guardianPhoneAt: 1700000000000, active: true }];
  const out = M(loc, srv);
  assert.equal(norm(out[0].guardianPhone), '966568133414', 'رقم البطاقة ضاع عند الرفع');
  assert.equal(out[0].guardianPhoneAt, 1700000000000, 'الختم لم ينتقل إلى الحمولة المرفوعة');
});

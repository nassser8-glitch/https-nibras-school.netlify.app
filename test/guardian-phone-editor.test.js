'use strict';
/* =============================================================================
 * صلاحية «تهاني» (إدارية) لإضافة/تعديل أرقام جوال أولياء الأمور وحدها
 * -----------------------------------------------------------------------------
 * القصة: تهاني إدارية (ADMINISTRATIVE) ولا تملك قسم الطلاب على الخادم، وصندوق
 * «تعديل الرقم» في بطاقة الطالبة كان مقصوراً على المدير/الوكيل/المرشدة، فلا
 * تستطيع إضافة رقم ولي الأمر. المطلوب منحها الصلاحية وحدها مع «عدم فقدان
 * البيانات»: كتابتها تُدمج بحماية الختم الزمني على حقلي الرقم (والتأخر) فقط،
 * ولا تمسّ بقية حقول الطالبة ولا تحذف أحداً، وأدوات حسابات الطالبات (الإضافة/
 * الحذف/كلمات المرور) تبقى للمدير/الوكيل/المرشدة.
 * ========================================================================== */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const SW = fs.readFileSync(path.join(ROOT, 'public', 'sw.js'), 'utf8');

const TEHANI = 'id_61e90132bc11ff7b';

function extractFn(src, name){
  const token = 'function ' + name + '(';
  const idx = src.indexOf(token);
  if(idx < 0) throw new Error('fn not found: ' + name);
  let i = src.indexOf('{', idx);
  let depth = 0;
  for(; i < src.length; i++){
    const ch = src[i];
    if(ch === '{') depth++;
    else if(ch === '}'){ depth--; if(depth === 0) return src.slice(idx, i + 1); }
  }
  throw new Error('unbalanced fn: ' + name);
}
const norm = v => String(v ?? '').replace(/\D/g, '');

// ---- الخادم: قائمة الصلاحية + الدمج الآمن ----
function loadServerMergeStudentsLateOnly(){
  const listMatch = SERVER.match(/const GUARDIAN_PHONE_EDITOR_IDS = \[[^\]]*\];/);
  assert.ok(listMatch, 'قائمة GUARDIAN_PHONE_EDITOR_IDS غير موجودة في الخادم');
  const code = [
    listMatch[0],
    extractFn(SERVER, 'isGuardianPhoneEditor'),
    extractFn(SERVER, 'mergeStudentsLateOnly'),
    ';globalThis.M = mergeStudentsLateOnly; globalThis.IS = isGuardianPhoneEditor;',
  ].join('\n');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return ctx;
}

test('1) قائمة الخادم تضم تهاني وحدها، وisGuardianPhoneEditor تعمل بالمعرّف', () => {
  const list = SERVER.match(/const GUARDIAN_PHONE_EDITOR_IDS = \[([^\]]*)\];/)[1];
  assert.ok(list.includes(TEHANI), 'معرّف تهاني غير موجود في القائمة');
  assert.strictEqual((list.match(/id_/g) || []).length, 1, 'القائمة يجب أن تحوي معرّفاً واحداً فقط');
  const S = loadServerMergeStudentsLateOnly();
  assert.equal(S.IS(TEHANI), true, 'تهاني يجب أن تُصرَّح');
  assert.strictEqual(S.IS('id_admin_seed'), false, 'حساب آخر لا يُصرَّح');
  assert.strictEqual(S.IS(''), false);
  assert.strictEqual(S.IS(undefined), false);
});

test('1b) الواجهة: البوابة تُصرّح لتهاني وللمدير/الوكيل/المرشدة فقط', () => {
  const listMatch = SRC.match(/const GUARDIAN_PHONE_EDITOR_IDS = \[[^\]]*\];/);
  assert.ok(listMatch, 'قائمة الواجهة مفقودة');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext('globalThis.isManager = (u)=>!!(u && (u.role==="ADMIN"||u.role==="AGENT"||u.role==="COUNSELOR"));\n' +
    listMatch[0] + '\n' + extractFn(SRC, 'canEditGuardianPhone') + '\nglobalThis.f = canEditGuardianPhone;', ctx);
  const f = ctx.f;
  assert.strictEqual(f({ id: TEHANI, role: 'ADMINISTRATIVE' }), true, 'تهاني تُصرَّح');
  assert.strictEqual(f({ id: 'x', role: 'ADMIN' }), true, 'المدير');
  assert.strictEqual(f({ id: 'x', role: 'AGENT' }), true, 'الوكيل');
  assert.strictEqual(f({ id: 'x', role: 'COUNSELOR' }), true, 'المرشدة');
  assert.strictEqual(f({ id: 'other', role: 'ADMINISTRATIVE' }), false, 'إدارية أخرى لا تُصرَّح');
  assert.strictEqual(f({ id: 'x', role: 'TEACHER' }), false, 'المعلمة مرفوضة');
  assert.strictEqual(f({ id: 'x', role: 'SCHOOL_AGENT' }), false, 'وكيلة الشؤون مرفوضة');
  assert.strictEqual(f(null), false, 'زائر مرفوض');
});

test('2) بلا opts.guardianPhone: سلوك التأخر محفوظ والرقم لا يُمسّ (أدوار أخرى بلا تغيير)', () => {
  const S = loadServerMergeStudentsLateOnly();
  const prev = [{ id: 's1', guardianPhone: '966500000000', guardianPhoneAt: 9000, lateMinutes: { '2026-10-19': 5 } }];
  const inc  = [{ id: 's1', guardianPhone: '966511111111', guardianPhoneAt: 9500, lateMinutes: { '2026-10-19': 9 } }];
  const out = S.M(prev, inc);
  assert.deepStrictEqual(out[0].lateMinutes, { '2026-10-19': 9 }, 'حقلا التأخر لم يُدمجا');
  assert.strictEqual(norm(out[0].guardianPhone), '966500000000', 'الرقم تغيّر بلا تصريح');
  assert.strictEqual(out[0].guardianPhoneAt, 9000, 'الختم تغيّر بلا تصريح');
});

test('3) مع opts.guardianPhone: الرقم يُكتب بحماية الختم — الأحدث يفوز', () => {
  const S = loadServerMergeStudentsLateOnly();
  const prev = [{ id: 's1', guardianPhone: '966500000000', guardianPhoneAt: 9000, classId: 'c9' }];
  const inc  = [{ id: 's1', guardianPhone: '966511111111', guardianPhoneAt: 9500 }];
  const out = S.M(prev, inc, { guardianPhone: true });
  assert.strictEqual(norm(out[0].guardianPhone), '966511111111', 'رقم أحدث لم يُكتب');
  assert.strictEqual(out[0].guardianPhoneAt, 9500, 'الختم الأحدث لم ينتقل');
  assert.strictEqual(out[0].classId, 'c9', 'حقل غير مسموح (classId) ضاع');
});

test('4) مع opts.guardianPhone: دفعة أقدم بختم أقدم لا تمحو رقماً أحدث محفوظاً في الخادم', () => {
  const S = loadServerMergeStudentsLateOnly();
  const prev = [{ id: 's1', guardianPhone: '966500000000', guardianPhoneAt: 9000 }];
  const inc  = [{ id: 's1', guardianPhone: '', guardianPhoneAt: 0 }];
  const out = S.M(prev, inc, { guardianPhone: true });
  assert.strictEqual(norm(out[0].guardianPhone), '966500000000', 'الرقم مُسح بنسخة أقدم');
  assert.strictEqual(out[0].guardianPhoneAt, 9000, 'الختم الأحدث ضاع');
});

test('5) مع opts.guardianPhone: لا حذف لأي طالبة ولا إسقاط لبيانات زميلاتها', () => {
  const S = loadServerMergeStudentsLateOnly();
  const prev = [{ id: 's1', guardianPhone: '966500000000' }, { id: 's2', fullName: 'زميلة', classId: 'c1' }];
  const inc  = [{ id: 's1', guardianPhone: '966511111111', guardianPhoneAt: 1000 }];
  const out = S.M(prev, inc, { guardianPhone: true });
  assert.strictEqual(out.length, 2, 'طالبة اختفت');
  const s1 = out.find(s => s.id === 's1');
  const s2 = out.find(s => s.id === 's2');
  assert.strictEqual(norm(s1.guardianPhone), '966511111111', 'رقم تهاني ضاع');
  assert.strictEqual(s2.fullName, 'زميلة');
  assert.strictEqual(s2.classId, 'c1', 'بيانات زميلة ضاعت');
});

test('6) ختم أحدث مع رقم فارغ ينشر المسح (إزالة الرقم)', () => {
  const S = loadServerMergeStudentsLateOnly();
  const prev = [{ id: 's1', guardianPhone: '966500000000', guardianPhoneAt: 1000 }];
  const inc  = [{ id: 's1', guardianPhone: '', guardianPhoneAt: 9000 }];
  const out = S.M(prev, inc, { guardianPhone: true });
  assert.strictEqual(norm(out[0].guardianPhone), '', 'المسح لم ينشر');
});

test('7) الواجهة: الصندوق في بطاقة الطالبة مُبوَّب بالدالة الجديدة', () => {
  assert.ok(SRC.includes('const GUARDIAN_PHONE_EDITOR_IDS = ['), 'قائمة الواجهة مفقودة');
  assert.ok(SRC.includes("'id_61e90132bc11ff7b'"), 'معرّف تهاني في الواجهة مفقود');
  assert.ok(SRC.includes('canEditGuardianPhone(currentUser())'), 'بوابة صندوق تعديل الرقم لم تُحدَّث');
  assert.ok(extractFn(SRC, 'editStudentPhone').includes('isAdminCadre('), 'بوابة تعديل الرقم الأساسية تغيّرت');
});

test('8) صفحة الطلاب: الاستيراد والقالب متاحان للصلاحية، وإضافة الطالب تبقى للمدير فقط', () => {
  const idx = SRC.indexOf('function renderStudents(');
  const body = SRC.slice(idx, idx + 2200);
  assert.ok(/\(canManage \|\| canEditGuardianPhone\(user\)\)/.test(body), 'قالب/استيراد الأرقام غير متاح لتهاني');
  assert.ok(body.includes('downloadStudentTemplate()'), 'زر القالب مفقود');
  assert.ok(body.includes('importStudents(event)'), 'زر الاستيراد مفقود');
  const addLine = body.split('\n').find(l => l.includes("toggleEl('studentForm')"));
  assert.ok(addLine, 'زر «إضافة طالب» مفقود');
  assert.ok(addLine.includes('${canManage ?'), 'زر «إضافة طالب» يجب أن يبقى للصلاحية الكاملة فقط');
  assert.ok(!addLine.includes('canEditGuardianPhone'), 'زر «إضافة طالب» يجب ألّا يُتاح لصلاحية الأرقام');
});

test('9) ربط الخادم: نداء الدمج يمرّر guardianPhone حسب حساب الجلسة', () => {
  assert.ok(SERVER.includes('{ guardianPhone: isGuardianPhoneEditor(req.session.user_id) }'),
    'الخادم لا يمنح الرقم للحساب المُصرَّح في مسار الدمج');
});

test('10) رفع نسخة الواجهة والخدمة المخزّنة', () => {
  const v = SRC.match(/const __APP_VER = '([^']+)'/);
  assert.ok(v, '__APP_VER مفقود');
  const swv = SRC.match(/sw\.js\?v=(\d+)/);
  assert.ok(swv, 'رقم sw.js?v مفقود');
  const cache = SW.match(/const CACHE_NAME = 'nibras-v(\d+)'/);
  assert.ok(cache, 'CACHE_NAME مفقود');
  assert.strictEqual(Number(cache[1]) >= Number(swv[1]), true, 'CACHE_NAME أقدم من رقم sw');
  assert.ok(v[1].includes('guardian-editor'), 'اسم الإصدار لا يعكس التغيير');
});

'use strict';
/* =============================================================================
 * تعطيل السلوك المؤذي لتطبيع المعلمات المكررة: كان يحذف حسابات حية من القسم
 * ويعيد توجيه ملكية الملاحظات/التحويلات/التكليفات إلى معرّف «أساسي» عبر استبدال
 * نصّي على JSON القاعدة — فتختفي تسجيلات المعلمات اللواتي لديهن اسمان متطابقان
 * في الكشف (شادية/سلوى هداية/سلوم — «نحفظ ثم تختفي»). + توسيع حامي 409 في
 * إعادة محاولة PUT ليشمل أي قسم تغيّر لا الطلاب فقط.
 * ========================================================================== */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

/** استخراج جسم دالة مسمّاة بمطابقة الأقواس (لا قواس داخل نصوص الدالة). */
function extractFunc(name) {
  const start = SRC.indexOf('function ' + name);
  assert.ok(start > -1, 'الدالة ' + name + ' غير موجودة');
  const open = SRC.indexOf('{', start);
  let depth = 0;
  let i = open;
  let inStr = null;
  for (; i < SRC.length; i++) {
    const ch = SRC[i];
    if (inStr) {
      if (ch === '\\') { i++; continue; }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) break; }
  }
  return SRC.slice(start, i + 1);
}

async function runNormalize(school, data) {
  const fnSrc = extractFunc('normalizeTeacherDuplicates');
  const sandbox = { data };
  const script = '(async function(){ ' + fnSrc + '\n return await normalizeTeacherDuplicates(' + JSON.stringify(school) + ', data); })();';
  return vm.runInNewContext(script, sandbox);
}

test('التطبيع لم يعد يمسح تكرار الاسم ولا يعيد توجيه الملكية', () => {
  assert.ok(!SRC.includes('function remapJsonRefs'), 'remapJsonRefs يجب أن يكون قد أُزيل');
  const block = SRC.slice(SRC.indexOf('async function normalizeTeacherDuplicates'),
    SRC.indexOf('async function normalizeTeacherDuplicates') + 900);
  assert.ok(!block.includes('canonToOrphan'), 'لم يعد هناك مفهوم أساسي/يتيم');
  assert.ok(!block.includes('deleted: true'), 'لا يُوسَم أي حساب حي بالحذف');
  assert.ok(!block.includes('.replace('), 'لا استبدال نصيّ على JSON');
});

test('حسابان بنفس username في الكشف يبقيان دون حذف ودون تغيير ملكية', async () => {
  const data = {
    users: [
      { id: 'id_a', username: 'shadia', name: 'شادية أ' },
      { id: 'id_b', username: 'shadia', name: 'شادية ب' },
      { id: 'id_ok', username: 'sana', name: 'سناء' },
    ],
    notes: [
      { id: 'n1', studentId: 's1', createdBy: 'id_a', description: 'ملاحظة أ' },
      { id: 'n2', studentId: 's1', createdBy: 'id_b', description: 'ملاحظة ب' },
    ],
    transfers: [
      { id: 't1', studentId: 's2', createdBy: 'id_a', target: 'x' },
    ],
    assignments: [
      { id: 'A1', classId: 'c1', teacherId: 'id_b', title: 'تكليف ب' },
    ],
  };
  const res = await runNormalize('GIRLS', data);
  assert.strictEqual(res.remapped, 0);
  assert.strictEqual(res.dropped, 0);
  assert.strictEqual(data.users.length, 3, 'لا حذف لأي حساب حي');
  assert.ok(data.users.every(u => !u.deleted), 'لا صف يحمل deleted');
  assert.strictEqual(data.notes.find(n => n.id === 'n1').createdBy, 'id_a', 'ملكية ملاحظة أ لم تتغير');
  assert.strictEqual(data.notes.find(n => n.id === 'n2').createdBy, 'id_b', 'ملكية ملاحظة ب لم تتغير');
  assert.strictEqual(data.transfers[0].createdBy, 'id_a', 'ملكية التحويل لم تتغير');
  assert.strictEqual(data.assignments[0].teacherId, 'id_b', 'نسب التكليف لم يتغير');
});

test('صف مكرر حِرفياً (نفس المعرّف مرتين) يُدمج فقط بالاحتفاظ بالأول', async () => {
  const data = {
    users: [
      { id: 'dup', username: 'x', name: 'أصل' },
      { id: 'dup', username: 'x', name: 'نسخة' },
    ],
  };
  const res = await runNormalize('GIRLS', data);
  assert.strictEqual(res.dropped, 1);
  assert.strictEqual(data.users.length, 1);
  assert.strictEqual(data.users[0].id, 'dup');
  assert.ok(!data.users[0].deleted);
});

test('حامي 409 في إعادة محاولة PUT يقارن كل الأقسام لا الطلاب فقط', () => {
  const anchor = SRC.indexOf('استُنفدت إعادة المحاولة');
  const block = SRC.slice(0, anchor);
  const loop = block.slice(Math.max(0, block.lastIndexOf('putAttempts = 0')), block.length);
  assert.ok(/SECTION_KEYS\.some\(/.test(loop), 'المقارنة تغطي جميع الأقسام (SECTION_KEYS)');
  assert.ok(/anySectionChanged/.test(loop), 'الشرط أصبح عاماً لكل الأقسام');
  assert.ok(!/jsonEqual\(cur\.data\.students, prev\.data\.students\)/.test(loop),
    'لم يعد الحارس مقتصراً على قسم الطلاب');
  assert.ok(/concurrent_change/.test(loop), 'لا يزال يُرجع 409 concurrent_change');
});
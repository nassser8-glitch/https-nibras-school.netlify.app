'use strict';
// إنشاء الصفوف الناقصة إجراء صريح فقط: فتح صفحة الفصول لا يكتب شيئاً.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

function extractFn(name) {
  const start = SRC.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('function not found: ' + name);
  const open = SRC.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}') { depth--; if (depth === 0) return SRC.slice(start, i + 1); }
  }
  throw new Error('unbalanced: ' + name);
}

const STAGES = [
  { id: 'kg_g0', name: 'التمهيدي', order: -1 },
  { id: 'b_g1', name: 'الأول الابتدائي', order: 0 }, { id: 'b_g2', name: 'الثاني الابتدائي', order: 1 },
  { id: 'b_g3', name: 'الثالث الابتدائي', order: 2 }, { id: 'b_g4', name: 'الرابع الابتدائي', order: 3 },
  { id: 'b_g5', name: 'الخامس الابتدائي', order: 4 }, { id: 'b_g6', name: 'السادس الابتدائي', order: 5 },
  { id: 'b_g7', name: 'الأول المتوسط', order: 6 }, { id: 'b_g8', name: 'الثاني المتوسط', order: 7 },
  { id: 'b_g9', name: 'الثالث المتوسط', order: 8 }, { id: 'b_g10', name: 'الأول الثانوي', order: 9 },
  { id: 'b_g11', name: 'الثاني الثانوي', order: 10 }, { id: 'b_g12', name: 'الثالث الثانوي', order: 11 },
];

function makeCtx(d) {
  const ctx = {
    console, JSON, Array, Object, Map, Set, Date,
    stages: STAGES.map(s => Object.assign({}, s)),
    d,
    saved: 0, renders: 0, toasts: [],
    loadDB: () => ctx.d,
    saveDB: () => { ctx.saved++; },
    renderApp: () => { ctx.renders++; },
    currentUser: () => ({ role: 'ADMIN' }),
    isManager: () => true,
    getActiveSchool: () => 'GIRLS',
    __uiToast: (m) => ctx.toasts.push(m),
  };
  vm.createContext(ctx);
  vm.runInContext(extractFn('__stageClassId') + '\n' + extractFn('__missingStageNames') + '\n' + extractFn('createMissingStageClasses'), ctx);
  return ctx;
}

function freshData() {
  return {
    grades: STAGES.slice(1).map(s => ({ id: s.id, name: s.name, order: s.order })),
    classes: [{ id: 'id_real_1', gradeId: 'b_g1', name: 'أ', campus: 'GIRLS', teacherIds: [] }],
    students: [], _blockedClasses: [],
  };
}

test('فتح صفحة الفصول لا يضيف صفوفاً ولا فصولاً (قراءة فقط)', () => {
  const d = freshData();
  const before = JSON.stringify(d);
  const ctx = makeCtx(d);
  const missing = ctx.__missingStageNames(ctx.d);
  assert.equal(JSON.stringify(ctx.d), before, 'الدالة الظاهرة للقراءة لا تكتب');
  assert.ok(missing.length > 0, 'تُظهر الصفوف الناقصة للمدير');
  assert.equal(ctx.saved, 0);
});

test('الإنشاء لا يحدث إلا عند استدعاء الإجراء الصريح، ويضيف الناقص فقط', () => {
  const d = freshData();
  const realBefore = JSON.stringify(d.classes.find(c => c.id === 'id_real_1'));
  const ctx = makeCtx(d);
  ctx.createMissingStageClasses();
  assert.equal(ctx.saved, 1, 'حفظ واحد عند الإجراء');
  assert.equal(JSON.stringify(ctx.d.classes.find(c => c.id === 'id_real_1')), realBefore, 'الفصل القائم لم يتغير');
  assert.equal(ctx.d.classes.length, STAGES.length, 'فصل قائم + 12 فصلاً ناقصاً = 13 مرحلة');
  assert.equal(ctx.__missingStageNames(ctx.d).length, 0, 'لا يبقى ناقص بعد الإنشاء');
});

test('تشغيل الإجراء مرتين لا يكرر ولا يحفظ مرة ثانية', () => {
  const d = freshData();
  const ctx = makeCtx(d);
  ctx.createMissingStageClasses();
  const count = ctx.d.classes.length;
  ctx.createMissingStageClasses();
  assert.equal(ctx.d.classes.length, count, 'لا فصول مكررة');
  assert.equal(ctx.saved, 1, 'الحفظ الثاني لا يحدث');
});

test('عرض الصفحة لا يستدعي دالة الإنشاء (renderClasses لا تحتوي كتابة)', () => {
  const body = extractFn('renderClasses');
  assert.equal(/createMissingStageClasses\(\)/.test(body.replace(/onclick="createMissingStageClasses\(\)"/, '')), false, 'لا استدعاء مباشر');
  assert.equal(/d\.classes\.push\(/.test(body), false, 'لا إضافة فصول داخل العرض');
  assert.equal(/saveDB\(d\)/.test(body), false, 'لا حفظ داخل العرض');
  assert.match(body, /onclick="createMissingStageClasses\(\)"/, 'الزر الصريح موجود');
});

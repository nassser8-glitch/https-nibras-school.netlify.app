'use strict';

// صف «التمهيدي» مستقل يظهر قبل «الأول الابتدائي» مباشرة، دون المساس بأي صف
// أو طالب أو فصل قائم. تُستخرج الشيفرة الحقيقية من public/index.html عبر vm.

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const INDEX_HTML_PATH = path.join(__dirname, '..', 'public', 'index.html');
const SRC = fs.readFileSync(INDEX_HTML_PATH, 'utf8');

const KINDERGARTEN = 'التمهيدي';
const FIRST_ELEMENTARY = 'الأول الابتدائي';
const PRE_EXISTING = [
  'الأول الابتدائي', 'الثاني الابتدائي', 'الثالث الابتدائي',
  'الرابع الابتدائي', 'الخامس الابتدائي', 'السادس الابتدائي',
  'الأول المتوسط', 'الثاني المتوسط', 'الثالث المتوسط',
  'الأول الثانوي', 'الثاني الثانوي', 'الثالث الثانوي',
];

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

function extractBlock(startMarker, endMarker) {
  const start = SRC.indexOf(startMarker);
  if (start === -1) throw new Error('block start not found: ' + startMarker);
  const end = SRC.indexOf(endMarker, start);
  if (end === -1) throw new Error('block end not found: ' + endMarker);
  return SRC.slice(start, end + endMarker.length);
}

function extractAutoRepairBlock() {
  const marker = 'stages.forEach(stage => {';
  let from = 0;
  for (;;) {
    const start = SRC.indexOf(marker, from);
    if (start === -1) throw new Error('auto-repair block not found');
    const open = SRC.indexOf('{', start);
    let depth = 0, i = open;
    for (; i < SRC.length; i++) {
      if (SRC[i] === '{') depth++;
      else if (SRC[i] === '}') { depth--; if (depth === 0) break; }
    }
    const end = SRC.indexOf(';', i);
    const block = SRC.slice(start, end + 1);
    if (block.includes('addedNames')) return block;
    from = end + 1;
  }
}

function loadStages() {
  const context = { console };
  vm.createContext(context);
  const literal = extractBlock('const stages = [', '];');
  vm.runInContext(literal + '\nglobalThis.__stages = stages;', context);
  vm.runInContext(extractFn('__stageOrder') + '\nglobalThis.__stageOrder = __stageOrder;', context);
  return context;
}

function orderedNames(context) {
  return context.__stages.slice().sort((a, b) => a.order - b.order).map(s => s.name);
}

test('«التمهيدي» صف مستقل موجود في قائمة الصفوف', () => {
  const { __stages } = loadStages();
  const kg = __stages.find(s => s.name === KINDERGARTEN);
  assert.ok(kg, 'التمهيدي موجود في stages');
  assert.equal(typeof kg.order, 'number', 'للتمهيدي قيمة ترتيب رقمية');
  assert.equal(__stages.filter(s => s.name === KINDERGARTEN).length, 1, 'يظهر مرة واحدة فقط');
});

test('«التمهيدي» يظهر قبل «الأول الابتدائي» مباشرة', () => {
  const { __stages } = loadStages();
  const kg = __stages.find(s => s.name === KINDERGARTEN);
  const first = __stages.find(s => s.name === FIRST_ELEMENTARY);
  assert.ok(kg.order < first.order, `ترتيب التمهيدي (${kg.order}) يجب أن يقل عن ترتيب الأول ابتدائي (${first.order})`);
  const names = orderedNames(loadStages());
  assert.equal(names.indexOf(KINDERGARTEN) + 1, names.indexOf(FIRST_ELEMENTARY), 'التمهيدي يسبق الأول ابتدائي بلا فاصل');
});

test('ترتيب بقية الصفوف لم يتغيّر (قيم order الأصلية 0..11 كما هي)', () => {
  const { __stages } = loadStages();
  const byName = new Map(__stages.map(s => [s.name, s.order]));
  PRE_EXISTING.forEach((name, i) => {
    assert.equal(byName.get(name), i, `${name} يجب أن يحتفظ بقيمته الأصلية ${i}`);
  });
  assert.equal(orderedNames(loadStages()).join('|'),
    [KINDERGARTEN].concat(PRE_EXISTING).join('|'), 'الترتيب الكامل: التمهيدي ثم الصفوف الاثنا عشر بترتيبها الأصلي');
});

test('أسماء الصفوف القائمة لم تُعدّل (لا إضافة ولا حذف ولا إعادة تسمية)', () => {
  const { __stages } = loadStages();
  const names = __stages.map(s => s.name);
  PRE_EXISTING.forEach(n => assert.ok(names.includes(n), `${n} ما زال موجودًا باسمه`));
  assert.equal(names.length, PRE_EXISTING.length + 1, 'عدد الصفوف زاد واحدًا فقط');
  const extras = Array.from(names).filter(n => !PRE_EXISTING.includes(n));
  assert.deepEqual(extras, [KINDERGARTEN], 'الصف الجديد الوحيد هو التمهيدي');
});

test('قيمة ترتيب الصفوف الجديدة لا تغيّر أي بيانات محفوظة (لا migration ولا ids في التعريف)', () => {
  const { __stages } = loadStages();
  __stages.forEach(s => {
    assert.deepEqual(Object.keys(s).sort(), ['name', 'order'], 'تعريف الصف بلا معرّف ولا بيانات مرتبطة');
  });
});

test('دالة الترتيب تعطي التمهيدي -1 وتترك الاسم غير المعروف على قيمته القديمة', () => {
  const { __stageOrder } = loadStages();
  assert.equal(__stageOrder(KINDERGARTEN, 99), -1, 'التمهيدي يأخذ ترتيبه الصحيح');
  assert.equal(__stageOrder(FIRST_ELEMENTARY, 99), 0);
  assert.equal(__stageOrder('الثالث الثانوي', 99), 11);
  assert.equal(__stageOrder('صف جديد يدوياً', 7), 7, 'الصف اليدوي غير المعروف يحتفظ بالترتيب القديم');
});

test('الفصول تُرتَّب فيظهر فصل التمهيدي قبل فصل الأول ابتدائي', () => {
  const context = {
    console, JSON, Array, Object, Map, Set, Date, isFinite,
    uid: (() => { let n = 0; return () => 'g' + (++n); })(),
    currentUser: () => ({ id: 'u1', role: 'ADMIN' }),
    seesAllClasses: () => true,
  };
  vm.createContext(context);
  const { __stages } = loadStages();
  const d = {
    grades: [
      { id: 'g6', name: FIRST_ELEMENTARY, order: 0 },
      { id: 'g12', name: 'الثالث الثانوي', order: 11 },
    ],
    classes: [
      { id: 'c_sec', gradeId: 'g12', name: 'أ' },
      { id: 'c_pri', gradeId: 'g6', name: 'ب' },
      { id: 'c_kg', gradeId: 'g0', name: 'أ' },
      { id: 'c_dead', gradeId: 'g6', name: 'ج', deleted: true },
    ],
  };
  d.grades.unshift({ id: 'g0', name: KINDERGARTEN, order: __stages.find(s => s.name === KINDERGARTEN).order });
  context.d = d;
  vm.runInContext('function loadDB(){ return d; }\nglobalThis.__loadDB = loadDB;', context);
  vm.runInContext(extractFn('gradeById'), context);
  vm.runInContext(extractFn('getClassesSorted') + '\nglobalThis.__sorted = getClassesSorted();', context);
  assert.deepEqual(Array.from(context.__sorted, c => c.id), ['c_kg', 'c_pri', 'c_sec'], 'الترتيب: تمهيدي ثم ابتدائي ثم ثانوي');
  assert.equal(Array.from(context.__sorted).some(c => c.id === 'c_dead'), false, 'الفصول المحذوفة لا تظهر (سلوك سابق)');
});

test('الإكمال التلقائي للصفوف يضيف التمهيدي فقط ولا يمس صفاً أو طالباً أو فصلاً قائماً', () => {
  const context = {
    console, JSON, Array, Object, Map, Set, Date, isFinite,
    uid: (() => { let n = 0; return () => 'new' + (++n); })(),
  };
  vm.createContext(context);
  const { __stages } = loadStages();
  const existingGrades = Array.from(__stages).filter(s => s.name !== KINDERGARTEN)
    .map((s, i) => ({ id: 'g' + i, name: s.name, order: s.order }));
  const existingClasses = existingGrades.map((g, i) => ({ id: 'c' + i, gradeId: 'g' + i, name: 'أ', campus: 'GIRLS' }));
  const existingStudents = [
    { id: 's1', fullName: 'طالبة قائمة', classId: 'c0', active: true },
    { id: 's2', fullName: 'طالبة ثانية', classId: 'c5', active: true },
  ];
  const before = JSON.stringify({ grades: existingGrades, classes: existingClasses, students: existingStudents });
  context.d = { grades: existingGrades.slice(), classes: existingClasses.slice(), students: existingStudents.slice() };
  context.stages = Array.from(__stages);
  context.campus = 'GIRLS';
  context.added = 0;
  context.addedNames = [];
  vm.runInContext(extractAutoRepairBlock(), context);

  const kg = context.d.grades.find(g => g.name === KINDERGARTEN);
  assert.ok(kg, 'التمهيدي أُضيف');
  assert.equal(kg.order, -1, 'بقيمته الصحيحة');
  assert.equal(context.d.grades.length, existingGrades.length + 1, 'صف واحد فقط أُضيف');
  assert.equal(context.d.classes.length, existingClasses.length + 1, 'فصل واحد فقط أُضيف');
  assert.equal(context.added, 1, 'رسالة الإضافة تذكر صفًا واحدًا');
  assert.deepEqual(Array.from(context.addedNames), [KINDERGARTEN]);
  assert.equal(context.d.classes.filter(c => c.gradeId === kg.id).length, 1, 'فصل التمهيدي يشير إلى صفه');
  const after = JSON.stringify({
    grades: context.d.grades.filter(g => g.name !== KINDERGARTEN),
    classes: context.d.classes.filter(c => c.gradeId !== kg.id),
    students: context.d.students,
  });
  assert.equal(after, before, 'الصفوف والفصول والطالبات القائمة كلها كما هي بايتًا ببايت');
});

test('الإكمال التلقائي لا يكرر شيئًا عند تشغيله مرة أخرى (idempotent)', () => {
  const context = { console, JSON, Array, Object, Map, Set, Date, isFinite, uid: () => 'x', campus: 'GIRLS', added: 0, addedNames: [] };
  vm.createContext(context);
  const { __stages } = loadStages();
  context.d = {
    grades: Array.from(__stages).map((s, i) => ({ id: 'g' + i, name: s.name, order: s.order })),
    classes: [], students: [],
  };
  context.stages = Array.from(__stages);
  const block = extractAutoRepairBlock();
  vm.runInContext(block, context);
  const gradesAfterFirst = context.d.grades.length;
  const classesAfterFirst = context.d.classes.length;
  context.added = 0;
  context.addedNames = [];
  vm.runInContext(block, context);
  assert.equal(context.d.grades.length, gradesAfterFirst, 'لا صفوف مكررة');
  assert.equal(context.d.classes.length, classesAfterFirst, 'لا فصول مكررة');
  assert.equal(context.added, 0, 'لا رسائل إضافة');
});

test('نوافذ المراحل في لوحة الأوائل تشمل التمهيدي ضمن الابتدائي', () => {
  const pri = SRC.match(/label:'[^']*ابتدائي[^']*', min:(-?\d+), max:(-?\d+)/g) || [];
  assert.equal(pri.length, 3, 'النوافذ الثلاثة موجودة');
  pri.forEach(line => {
    assert.match(line, /min:-1, max:5/, 'الابتدائي يشمل التمهيدي دون تغيير حدّه الأعلى: ' + line);
  });
  const mid = SRC.match(/label:'[^']*متوسط[^']*', min:(-?\d+), max:(-?\d+)/g) || [];
  const sec = SRC.match(/label:'[^']*ثانوي[^']*', min:(-?\d+), max:(-?\d+)/g) || [];
  mid.forEach(line => assert.match(line, /min:6, max:8/, 'المتوسط لم يتغير: ' + line));
  sec.forEach(line => assert.match(line, /min:9, max:11/, 'الثانوي لم يتغير: ' + line));
});

test('رسائل retrofitting لم تعد تحتوي أرقامًا ثابتة تناقض 13 صفًا', () => {
  assert.equal(SRC.includes('12 فصل'), false, 'لا عدد فصول ثابت');
  assert.equal(SRC.includes('(3 متوسط + 3 ثانوي)'), false, 'لا تفصيل ثابت للصفوف المضافة');
  assert.match(SRC, /\$\{stages\.length\} صف/, 'عدد الصفوف يُحسب من stages');
  assert.match(SRC, /addedNames\.join/, 'أسماء الصفوف المضافة تُحسب من الكود');
});

test('تقرير ملخّص الفصول يعتمد getClassesSorted (ترتيب الصفوف)', () => {
  assert.match(SRC, /const classes = getClassesSorted\(\)\.filter\(c => canSeeClass\(c\.id\)/,
    'تقرير class_summary مرتَّب بترتيب الصفوف');
});

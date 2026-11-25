'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

function extractFn(name) {
  const i = HTML.search(new RegExp('function\\s+' + name + '\\s*\\('));
  assert.ok(i >= 0, 'Missing function ' + name);
  const open = HTML.indexOf('{', i);
  let d = 0;
  for (let k = open; k < HTML.length; k++) {
    if (HTML[k] === '{') d++;
    else if (HTML[k] === '}') {
      d--;
      if (d === 0) return HTML.slice(i, k + 1);
    }
  }
  throw new Error('Unbalanced ' + name);
}

test('1) getClassesSorted تستبعد المحذوفة والفارغة والمكررة وترتب التمهيدي أولًا', () => {
  const db = {
    grades: [
      { id: 'g0', name: 'التمهيدي', order: 0 },
      { id: 'g1', name: 'الأول الابتدائي', order: 1 }
    ],
    classes: [
      { id: 'c_del', gradeId: 'g1', name: 'ب', deleted: true },
      { id: 'c_empty', gradeId: 'g1', name: '   ' },
      { id: 'c_badg', gradeId: 'g_missing', name: 'أ' },
      { id: 'c_dup_empty', gradeId: 'g1', name: 'أ', teacherIds: [] },
      { id: 'c_g1_a', gradeId: 'g1', name: 'أ', teacherIds: ['t1'] },
      { id: 'c_kg_a', gradeId: 'g0', name: 'أ', teacherIds: [] }
    ],
    students: [
      { id: 's1', classId: 'c_g1_a', active: true }
    ]
  };
  const ctx = {
    loadDB: () => db,
    currentUser: () => ({ id: 'admin1', role: 'ADMIN' }),
    seesAllClasses: () => true,
    gradeById: id => db.grades.find(g => g.id === id) || null,
    gradeOrderOf: (g, gid) => (g && typeof g.order === 'number') ? g.order : 999,
    getAssignmentClassIds: () => []
  };
  vm.createContext(ctx);
  vm.runInContext(extractFn('getClassesSorted') + '\nglobalThis.__res = getClassesSorted();', ctx);

  assert.deepStrictEqual(Array.from(ctx.__res.map(c => c.id)), ['c_kg_a', 'c_g1_a']);
});

test('2) نافذة جدول الحصص تستخدم getClassesSorted ولا تعرض فصولًا محذوفة أو فارغة', () => {
  const fn = extractFn('openQuickSchedule');
  assert.ok(fn.includes('getClassesSorted()'), 'openQuickSchedule must use getClassesSorted()');
  assert.equal(fn.includes('(d.classes || []).filter'), false, 'openQuickSchedule must not read raw d.classes');
});

test('3) deleteClass تضع شاهد حذف deleted:true و_blockedClasses لمنع عودة الفصل عند المزامنة', () => {
  const db = {
    classes: [{ id: 'c1', gradeId: 'g1', name: 'ب' }],
    students: [],
    _blockedClasses: []
  };
  let saved = null;
  const ctx = {
    loadDB: () => db,
    saveDB: d => { saved = d; },
    renderApp: () => {},
    confirm: () => true,
    alert: () => {}
  };
  vm.createContext(ctx);
  vm.runInContext(extractFn('deleteClass') + '\ndeleteClass("c1");', ctx);

  assert.ok(saved && saved.classes.length === 1);
  assert.equal(saved.classes[0].deleted, true);
  assert.ok(saved._blockedClasses.includes('c1'));
});

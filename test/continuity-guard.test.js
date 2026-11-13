'use strict';
// حارس الاستمرارية: لا تُسقط الكتابة الواردة طالبات أو حضوراً أو ملاحظات محفوظة،
// ولا تُعيد فصلاً فيه طالبات بعلامة محذوف، ويبقى الحذف المقصود (ناعم أو نهائي) كما هو.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

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

const ctx = { console };
vm.createContext(ctx);
vm.runInContext(extractFn('protectContinuity'), ctx);

const base = () => ({
  students: [{ id: 's1', classId: 'c1' }, { id: 's2', classId: 'c2' }],
  notes: [{ id: 'n1', studentId: 's1' }, { id: 'n2', studentId: 's2' }],
  attendance: [{ id: 'a1', studentId: 's1', date: '2026-11-01' }],
  classes: [{ id: 'c1', deleted: true }, { id: 'c2', deleted: true }, { id: 'c3', deleted: true }],
  _blockedStudents: [], _blockedClasses: [],
});

test('كتابة كاملة لا تُغيّر شيئاً', () => {
  const prev = base();
  const clean = base();
  const r = ctx.protectContinuity(prev, clean);
  assert.equal(Object.keys(r).length, 0);
  assert.equal(clean.students.length, 2);
});

test('طالبة وملاحظة وحضور غائبة من الكتابة الواردة تُعاد', () => {
  const prev = base();
  const clean = base();
  clean.students = [{ id: 's1', classId: 'c1' }];
  clean.notes = [{ id: 'n1', studentId: 's1' }];
  clean.attendance = [];
  const r = ctx.protectContinuity(prev, clean);
  assert.equal(r.students, 1);
  assert.equal(r.notes, 1);
  assert.equal(r.attendance, 1);
  assert.equal(clean.students.length, 2);
  assert.equal(clean.notes.length, 2);
  assert.equal(clean.attendance.length, 1);
});

test('طالبة محذوفة نهائياً (في _blockedStudents) لا تُعاد مع ملاحظاتها', () => {
  const prev = base();
  prev._blockedStudents = ['s2'];
  const clean = base();
  clean.students = [{ id: 's1', classId: 'c1' }];
  clean.notes = [{ id: 'n1', studentId: 's1' }];
  ctx.protectContinuity(prev, clean);
  assert.equal(clean.students.some(s => s.id === 's2'), false);
  assert.equal(clean.notes.some(n => n.id === 'n2'), false);
});

test('فصل فيه طالبات لا يُعاد فتحه بعلامة محذوف من نسخة قديمة (بل يُعاد نشطاً)', () => {
  const prev = base();
  prev.classes[0].deleted = false;
  const clean = base();
  clean.classes[0].deleted = true;
  const r = ctx.protectContinuity(prev, clean);
  assert.equal(clean.classes[0].deleted, false);
  assert.equal(r.classesReopened, 1);
});

test('فصل بلا طالبات يبقى محذوفاً كما أراد الجهاز', () => {
  const prev = base();
  prev.classes[2].deleted = false;
  const clean = base();
  clean.classes[2].deleted = true;
  ctx.protectContinuity(prev, clean);
  assert.equal(clean.classes[2].deleted, true);
});

test('فصل محجوب نهائياً لا يُعاد فتحه', () => {
  const prev = base();
  prev.classes[0].deleted = false;
  prev._blockedClasses = ['c1'];
  const clean = base();
  clean.classes[0].deleted = true;
  ctx.protectContinuity(prev, clean);
  assert.equal(clean.classes[0].deleted, true);
});

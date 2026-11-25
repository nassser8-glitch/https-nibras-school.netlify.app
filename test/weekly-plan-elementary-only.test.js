'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const wp = require('../weekly-plans');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

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

const sampleData = {
  grades: [
    { id: 'kg_g0', name: 'التمهيدي', order: -1 },
    { id: 'b_g1', name: 'الأول الابتدائي', order: 0 },
    { id: 'b_g6', name: 'السادس الابتدائي', order: 5 },
    { id: 'b_g7', name: 'الأول المتوسط', order: 6 },
    { id: 'b_g10', name: 'الأول الثانوي', order: 9 },
  ],
  classes: [
    { id: 'c_kg', gradeId: 'kg_g0', name: 'أ', teacherIds: ['t_elem'] },
    { id: 'c_g1', gradeId: 'b_g1', name: 'أ', teacherIds: ['t_elem'] },
    { id: 'c_g6', gradeId: 'b_g6', name: 'أ', teacherIds: ['t_other'] },
    { id: 'c_g7', gradeId: 'b_g7', name: 'أ', teacherIds: ['t_mid', 't_elem'] },
    { id: 'c_g10', gradeId: 'b_g10', name: 'أ', teacherIds: ['t_high'] },
  ],
  students: [
    { id: 's_elem', classId: 'c_g1', active: true },
    { id: 's_mid', classId: 'c_g7', active: true },
  ],
};

test('1) حصر الفصول الابتدائية من الأول الابتدائي إلى السادس الابتدائي فقط', () => {
  assert.equal(wp.isElementaryClass(sampleData, 'c_g1'), true);
  assert.equal(wp.isElementaryClass(sampleData, 'c_g6'), true);
  assert.equal(wp.isElementaryClass(sampleData, 'c_kg'), false);
  assert.equal(wp.isElementaryClass(sampleData, 'c_g7'), false);
  assert.equal(wp.isElementaryClass(sampleData, 'c_g10'), false);
});

test('2) extractTeacherAssignments مع elementaryOnly تقصر المعلم على فصوله الابتدائية فقط', () => {
  const elem = wp.extractTeacherAssignments(sampleData, 't_elem', { elementaryOnly: true });
  assert.deepStrictEqual(Array.from(elem.classIds), ['c_g1']);

  const mid = wp.extractTeacherAssignments(sampleData, 't_mid', { elementaryOnly: true });
  assert.deepStrictEqual(Array.from(mid.classIds), []);

  const high = wp.extractTeacherAssignments(sampleData, 't_high', { elementaryOnly: true });
  assert.deepStrictEqual(Array.from(high.classIds), []);
});

test('3) الواجهة: المعلم غير الابتدائي محجوب حتى عبر الرابط المباشر، ومعلم الابتدائي يرى فصوله فقط', () => {
  const ctx = {
    loadDB: () => sampleData,
    getAssignmentClassIds: (u, d) => d.classes.filter(c => (c.teacherIds || []).includes(u.id)).map(c => c.id),
    renderWeeklyPlanTeacher: u => 'TEACHER_PAGE:' + u.id,
    renderWeeklyPlanStudent: () => 'STUDENT_PAGE',
    renderWeeklyPlanAdmin: () => 'ADMIN_PAGE',
  };
  vm.createContext(ctx);
  vm.runInContext(
    "const __WP_ELEM_GRADE_IDS = new Set(['b_g1', 'b_g2', 'b_g3', 'b_g4', 'b_g5', 'b_g6']);\n" +
    "const __WP_ELEM_GRADE_NAMES = new Set(['الأول الابتدائي', 'الثاني الابتدائي', 'الثالث الابتدائي', 'الرابع الابتدائي', 'الخامس الابتدائي', 'السادس الابتدائي']);\n" +
    extractFn('wpIsElementaryGrade') + '\n' +
    extractFn('wpIsElementaryClass') + '\n' +
    extractFn('wpIsStudentElementary') + '\n' +
    extractFn('wpTeacherAvailableClasses') + '\n' +
    extractFn('renderWeeklyPlanPage'),
    ctx
  );

  const elemClasses = ctx.wpTeacherAvailableClasses({ id: 't_elem', role: 'TEACHER' }, sampleData);
  assert.deepStrictEqual(Array.from(elemClasses.map(c => c.id)), ['c_g1']);
  assert.equal(ctx.renderWeeklyPlanPage({ id: 't_elem', role: 'TEACHER' }), 'TEACHER_PAGE:t_elem');

  const midClasses = ctx.wpTeacherAvailableClasses({ id: 't_mid', role: 'TEACHER' }, sampleData);
  assert.deepStrictEqual(Array.from(midClasses), []);
  assert.ok(ctx.renderWeeklyPlanPage({ id: 't_mid', role: 'TEACHER' }).includes('المرحلة الابتدائية فقط'));
  assert.ok(ctx.renderWeeklyPlanPage({ id: 't_high', role: 'TEACHER' }).includes('المرحلة الابتدائية فقط'));

  assert.equal(ctx.renderWeeklyPlanPage({ id: 's_elem', role: 'STUDENT' }), 'STUDENT_PAGE');
  assert.ok(ctx.renderWeeklyPlanPage({ id: 's_mid', role: 'STUDENT' }).includes('الابتدائية فقط'));
});

test('4) الخادم يتحقق من المرحلة الابتدائية والصلاحية على مسارات الخطة الأسبوعية', () => {
  assert.ok(SERVER.includes('function teacherAssignedElementaryClassIds('));
  assert.ok(SERVER.includes("error: 'elementary_teachers_only'"));
  assert.ok(SERVER.includes("error: 'elementary_classes_only'"));
  assert.ok(SERVER.includes("error: 'elementary_only'"));
  assert.ok(HTML.includes("wpTeacherAvailableClasses(user, loadDB()).length > 0"));
});

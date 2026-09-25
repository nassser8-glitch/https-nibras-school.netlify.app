'use strict';

// allows only SCHOOL_AGENT (وكيلة الشؤون المدرسية) to see the teachers list and
// write teacher/admin absence & lateness. Extracted from public/index.html via vm.

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const INDEX_HTML_PATH = path.join(__dirname, '..', 'public', 'index.html');

function extractFn(marker) {
  const src = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
  const startIdx = src.indexOf('function ' + marker + '(');
  if (startIdx === -1) throw new Error('function not found in index.html: ' + marker);
  const openBrace = src.indexOf('{', startIdx);
  let depth = 0, i = openBrace;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(startIdx, i + 1);
}

function loadRoleHelpers() {
  const context = { console, JSON, Array, Object, Math };
  vm.createContext(context);
  for (const m of ['isManager', 'isAdminRole', 'canManageTeachers']) {
    vm.runInContext(extractFn(m), context);
  }
  return context;
}

test('وكيلة الشؤون المدرسية مسموح لها بإدارة حضور المعلمات', () => {
  const { canManageTeachers } = loadRoleHelpers();
  assert.equal(canManageTeachers({ role: 'SCHOOL_AGENT' }), true);
  assert.equal(canManageTeachers({ role: 'ADMIN' }), true, 'المدير كما كان');
  assert.equal(canManageTeachers({ role: 'AGENT' }), true, 'الوكيل كما كان');
});

test('بقية الأدوار المدرسية تبقى بلا صلاحية حضور المعلمات', () => {
  const { canManageTeachers } = loadRoleHelpers();
  for (const role of ['COUNSELOR', 'ADMINISTRATIVE', 'TEACHER', 'STUDENT']) {
    assert.equal(canManageTeachers({ role }), false, role + ' must not manage teachers');
  }
  assert.ok(!canManageTeachers(null), 'لا مستخدم = لا صلاحية');
});

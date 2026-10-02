'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

function extractFunction(name) {
  const start = src.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, 'function exists: ' + name);
  const brace = src.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error('unterminated function: ' + name);
}

const TRANSFER = {
  id: 'T-OLD-1',
  studentId: 'S-OLD-1',
  target: 'COUNSELOR',
  priority: 'HIGH',
  reason: 'Historical case',
  status: 'PENDING',
  createdBy: 'former-teacher',
};

function makePage(initialData, existingStorage) {
  const storage = existingStorage || new Map([
    ['nibras_GIRLS_db_v1', JSON.stringify(initialData)],
  ]);
  const user = { id: 'admin-1', role: 'ADMIN' };
  const context = {
    Array, JSON, Map, Set, Object, String, Date,
    localStorage: {
      getItem: key => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => storage.set(key, value),
    },
    currentUser: () => user,
    getActiveSchool: () => 'GIRLS',
    loadDB: () => JSON.parse(storage.get('nibras_GIRLS_db_v1')),
    saveDB: data => storage.set('nibras_GIRLS_db_v1', JSON.stringify(data)),
    pointItems: () => [],
    studentIdsOf: null,
    studentNameLink: student => student.fullName,
    targetLabel: target => target,
    targetLabels: { AGENT: 'Agent', COUNSELOR: 'Counselor', ADMIN: 'Admin' },
    priorityLabels: { HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low', URGENT: 'Urgent' },
    escapeHtml: value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch])),
    campusLabels: { GIRLS: 'Girls' },
    getClassesSorted: () => [],
    transferReasons: [],
    document: {
      getElementById: id => ({
        tTarget: { value: 'COUNSELOR' },
        tPriority: { value: 'MEDIUM' },
        tReason: { value: 'New case' },
        tOther: { value: '' },
        tReasonComment: { value: '' },
      }[id] || null),
    },
    getCheckedStudentIds: () => ['S-NEW-1'],
    transferDeductionMap: { 'New case': 0 },
    uid: () => 'T-NEW-1',
    notifyTransferReceivers: () => {},
    renderApp: () => {},
    alert: () => {},
  };
  vm.createContext(context);
  for (const name of ['studentIdsOf', 'renderTransfers', 'transferForMe', 'addTransfer']) {
    vm.runInContext(extractFunction(name), context);
  }
  return { context, storage };
}

function initialDB(transfers) {
  return {
    transfers,
    students: [
      { id: 'S-OLD-1', fullName: 'Historical student' },
      { id: 'S-NEW-1', fullName: 'New student' },
    ],
    notes: [],
    users: [],
  };
}

test('المدير يرى التحويلات القديمة المحفوظة حتى لو لم ينشئها أو تكن موجهة إليه', () => {
  const { context } = makePage(initialDB([TRANSFER]));
  const html = context.renderTransfers();

  assert.match(html, /Historical student/);
  assert.doesNotMatch(html, /لا توجد تحويلات بعد/);
});

test('رسالة عدم وجود تحويلات لا تظهر إلا عندما تكون القائمة فارغة فعلًا', () => {
  const { context } = makePage(initialDB([]));
  const html = context.renderTransfers();

  assert.match(html, /لا توجد تحويلات بعد/);
});

test('إضافة تحويل جديد تحافظ على التحويل القديم وتبقى بعد إعادة تحميل الصفحة', () => {
  const { context, storage } = makePage(initialDB([TRANSFER]));

  context.addTransfer();
  const saved = JSON.parse(storage.get('nibras_GIRLS_db_v1'));
  assert.deepEqual(saved.transfers.map(item => item.id), ['T-OLD-1', 'T-NEW-1']);
  assert.deepEqual(saved.transfers[0], TRANSFER);

  const reloaded = makePage(null, storage);
  const html = reloaded.context.renderTransfers();
  assert.match(html, /Historical student/);
  assert.match(html, /New student/);
  assert.doesNotMatch(html, /لا توجد تحويلات بعد/);
});

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

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

function extractServerFunction(name) {
  const start = serverSrc.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, 'server function exists: ' + name);
  const brace = serverSrc.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < serverSrc.length; i++) {
    if (serverSrc[i] === '{') depth++;
    else if (serverSrc[i] === '}' && --depth === 0) return serverSrc.slice(start, i + 1);
  }
  throw new Error('unterminated server function: ' + name);
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

function makePage(initialData, existingStorage, user = { id: 'admin-1', role: 'ADMIN' }) {
  const storage = existingStorage || new Map([
    ['nibras_GIRLS_db_v1', JSON.stringify(initialData)],
  ]);
  const context = {
    Array, JSON, Map, Set, Object, String, Date,
    localStorage: {
      getItem: key => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => storage.set(key, value),
    },
    currentUser: () => user,
    getActiveSchool: () => 'GIRLS',
    getVisibleStudents: () => [],
    loadDB: () => JSON.parse(storage.get('nibras_GIRLS_db_v1')),
    studentById: id => JSON.parse(storage.get('nibras_GIRLS_db_v1')).students.find(student => student.id === id),
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
        trSolveText: { value: 'متابعة الحالة وحل المشكلة' },
      }[id] || null),
    },
    getCheckedStudentIds: () => ['S-NEW-1'],
    transferDeductionMap: { 'New case': 0 },
    uid: () => 'T-NEW-1',
    notifyTransferReceivers: () => {},
    NRC_notifyTransferServer: () => {},
    renderApp: () => {},
    closeDetails: () => {},
    alert: () => {},
  };
  vm.createContext(context);
  for (const name of ['studentIdsOf', 'renderTransfers', 'transferForMe', 'addTransfer', 'saveTransferSolution', 'mergeTransfersByIdNewer']) {
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

test('حفظ الحل يحدّث التحويل نفسه مع إبقاء معرّفه ومنشئه', () => {
  const sourceTeacherTransfer = { ...TRANSFER, createdBy: 'teacher-1' };
  const { context, storage } = makePage(initialDB([sourceTeacherTransfer]), undefined, {
    id: 'counselor-1', name: 'المرشدة', role: 'COUNSELOR',
  });

  context.saveTransferSolution('T-OLD-1');

  const saved = JSON.parse(storage.get('nibras_GIRLS_db_v1'));
  assert.equal(saved.transfers.length, 1);
  assert.equal(saved.transfers[0].id, 'T-OLD-1');
  assert.equal(saved.transfers[0].createdBy, 'teacher-1');
  assert.equal(saved.transfers[0].status, 'RESOLVED');
  assert.equal(saved.transfers[0].solution, 'متابعة الحالة وحل المشكلة');
  assert.equal(saved.transfers[0].resolvedBy, 'counselor-1');
  assert.ok(saved.transfers[0].updatedAt);
});

test('دمج المزامنة يحدّث سجل التحويل الموجود ولا يُسقطه أو يُبقي نسخة معلقة', () => {
  const { context } = makePage(initialDB([]));
  const resolved = {
    ...TRANSFER,
    status: 'RESOLVED',
    solution: 'تم حل المشكلة',
    resolvedAt: '2026-10-02T12:00:00.000Z',
    updatedAt: '2026-10-02T12:00:00.000Z',
  };
  const merged = context.mergeTransfersByIdNewer(
    [TRANSFER],
    [resolved, { ...TRANSFER, id: 'T-OLD-2' }],
  );

  assert.equal(merged.length, 2, 'السجل المحفوظ سابقًا والجديد كلاهما باقيان');
  assert.equal(merged.find(item => item.id === 'T-OLD-1').status, 'RESOLVED');
  assert.equal(merged.find(item => item.id === 'T-OLD-1').solution, 'تم حل المشكلة');
  assert.equal(merged.find(item => item.id === 'T-OLD-2').status, 'PENDING');
  assert.match(src, /sd\.transfers = mergeTransfersByIdNewer\(sd\.transfers, obj\.transfers\)/);
  assert.match(src, /merged\.transfers = mergeTransfersByIdNewer\(merged\.transfers, local\.transfers\)/);
});

test('المعلمة التي أنشأت التحويل ترى الحل بعد مزامنة السجل المحلول', () => {
  const resolved = {
    ...TRANSFER,
    createdBy: 'teacher-1',
    status: 'RESOLVED',
    solution: 'تم حل المشكلة',
    resolvedByName: 'المرشدة',
  };
  const { context } = makePage(initialDB([resolved]), undefined, {
    id: 'teacher-1', role: 'TEACHER',
  });
  const html = context.renderTransfers();

  assert.match(html, /تم حل المشكلة/);
  assert.match(html, /المرشدة/);
  assert.doesNotMatch(html, /بانتظار الجهة المعنية/);
});

test('رفع نسخة معلمة قديمة لا يعيد التحويل المحلول إلى قيد المتابعة على الخادم', () => {
  const context = { Array, Date, JSON, Map, String };
  vm.createContext(context);
  vm.runInContext(extractServerFunction('mergeTransfers'), context);

  const pending = { ...TRANSFER, createdAt: '2026-10-01T08:00:00.000Z' };
  const resolved = {
    ...pending,
    status: 'RESOLVED',
    solution: 'تم حل المشكلة',
    resolvedAt: '2026-10-02T12:00:00.000Z',
    updatedAt: '2026-10-02T12:00:00.000Z',
  };
  const afterStalePush = context.mergeTransfers([resolved], [pending]);

  assert.equal(afterStalePush.length, 1);
  assert.equal(afterStalePush[0].id, pending.id);
  assert.equal(afterStalePush[0].status, 'RESOLVED');
  assert.equal(afterStalePush[0].solution, 'تم حل المشكلة');
});

test('دمج الخادم يختار الحل المحدّث بين نسختين محلولتين', () => {
  const context = { Array, Date, JSON, Map, String };
  vm.createContext(context);
  vm.runInContext(extractServerFunction('mergeTransfers'), context);

  const olderResolution = {
    ...TRANSFER,
    status: 'RESOLVED',
    solution: 'حل سابق',
    resolvedAt: '2026-10-02T10:00:00.000Z',
  };
  const latestResolution = {
    ...olderResolution,
    solution: 'الحل النهائي',
    resolvedAt: '2026-10-02T12:00:00.000Z',
  };
  const merged = context.mergeTransfers([olderResolution], [latestResolution]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].solution, 'الحل النهائي');
  assert.match(serverSrc, /if \(key === 'transfers'\) \{ merged\[key\] = mergeTransfers\(a, b\); continue; \}/);
  assert.match(serverSrc, /cf\.transfers = mergeTransfers\(prev\.data\.transfers, cf\.transfers\)/);
});

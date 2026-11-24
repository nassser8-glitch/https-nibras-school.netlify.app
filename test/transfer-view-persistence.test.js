'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const SRV = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const transferPrivacy = require('../transfers-privacy');

function sliceBetween(src, startMarker, endMarker) {
  const i = src.indexOf(startMarker);
  assert.ok(i !== -1, 'missing startMarker: ' + startMarker);
  const j = src.indexOf(endMarker, i);
  assert.ok(j !== -1, 'missing endMarker: ' + endMarker);
  return src.slice(i, j);
}

function loadClientTransferEnv(user, db) {
  const mergePullCode = sliceBetween(HTML, 'function __mergeTransfersPull(lArr, sArr){', '\n/* نفس المقارنة لكن متجاهلةً _ts');
  const transfersCode = sliceBetween(HTML, '/* ============ التحويلات ============ */', '\nfunction deleteTransfer(id){');
  const helpersCode = sliceBetween(HTML, 'function transferForMe(t){', '\nfunction openTransferSolve(id){');

  const modals = [];
  const sandbox = {
    console, Date, Math, JSON, Object, Array, Set, Map, Number, String,
    currentUser: () => user,
    getActiveSchool: () => 'GIRLS',
    loadDB: () => db,
    saveDB: (next) => { Object.assign(db, next); },
    renderApp: () => {},
    closeDetails: () => { modals.length = 0; },
    __syncSchedule: () => {},
    pointItems: () => [],
    studentIdsOf: (t) => Array.isArray(t.studentIds) ? t.studentIds : (t.studentId ? [t.studentId] : []),
    studentNameLink: (s) => `<span>${s.fullName}</span>`,
    targetLabel: (v) => ({ AGENT:'الوكيلة', COUNSELOR:'الموجهة الطلابية', ADMIN:'المدير' }[v] || v),
    targetLabels: { AGENT:'الوكيلة', COUNSELOR:'الموجهة الطلابية', ADMIN:'المدير' },
    priorityLabels: { LOW:'منخفضة', MEDIUM:'متوسطة', HIGH:'مرتفعة', URGENT:'عاجلة' },
    transferReasons: ['الغياب المتكرر'],
    campusLabels: { GIRLS:'بنات' },
    getClassesSorted: () => [],
    classLabel: (c) => c.name,
    escapeHtml: (v) => String(v == null ? '' : v).replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch])),
    fmtTime: (iso) => String(iso || '').slice(0, 10),
    document: {
      body: { appendChild: (el) => modals.push(el) },
      createElement: () => ({ className: '', innerHTML: '', onclick: null })
    },
    __transferSolveStamp: (x) => Date.parse((x && (x.resolvedAt || x.updatedAt || x.createdAt)) || '') || 0
  };
  vm.createContext(sandbox);
  vm.runInContext(mergePullCode + '\n' + helpersCode + '\n' + transfersCode, sandbox);
  return { sandbox, modals, db };
}

function loadServerMergeTransfers() {
  const mergeSecCode = sliceBetween(SRV, 'function mergeSection(prevVal, inVal) {', '\n// ===== دمج التحويلات');
  const mergeTrCode = sliceBetween(SRV, 'function mergeTransfers(prev, incoming) {', '\n// ===== دمج رسائل المدير');
  const ctx = { Map, Set, Array, Object, String, Date, Number, Math, jsonEqual: (a, b) => JSON.stringify(a) === JSON.stringify(b) };
  vm.createContext(ctx);
  vm.runInContext(mergeSecCode + '\n' + mergeTrCode, ctx);
  return ctx.mergeTransfers;
}

test('1) تحويل من المدير إلى الوكيل والموجه الطلابي: يظل ظاهراً بعد الفتح والمغادرة والعودة', () => {
  const ADMIN = { id: 'adm1', name: 'المديرة', role: 'ADMIN' };
  const AGENT = { id: 'ag1', name: 'الوكيلة', role: 'AGENT' };
  const COUNSELOR = { id: 'cn1', name: 'الموجهة', role: 'COUNSELOR' };

  const db = {
    users: [ADMIN, AGENT, COUNSELOR],
    students: [{ id: 's1', fullName: 'سارة أحمد', classId: 'c1', active: true }],
    transfers: [
      { id: 't_ag', studentIds: ['s1'], studentId: 's1', target: 'AGENT', priority: 'HIGH', reason: 'غياب متكرر', status: 'PENDING', createdBy: 'adm1', createdAt: '2026-11-24T08:00:00.000Z' },
      { id: 't_cn', studentIds: ['s1'], studentId: 's1', target: 'COUNSELOR', priority: 'MEDIUM', reason: 'متابعة سلوكية', status: 'PENDING', createdBy: 'adm1', createdAt: '2026-11-24T09:00:00.000Z' }
    ]
  };

  // الوكيلة تفتح التحويل الموجه لها
  const envAgent = loadClientTransferEnv(AGENT, db);
  assert.equal(envAgent.sandbox.transferStatusInfo(db.transfers[0]).label, 'جديد');
  envAgent.sandbox.openTransferDetails('t_ag');
  assert.equal(envAgent.modals.length, 1);
  assert.equal(envAgent.sandbox.transferStatusInfo(db.transfers[0]).label, 'تمت المشاهدة');
  assert.ok(db.transfers[0].viewedBy.ag1, 'لم يُسجل اطلاع الوكيلة');
  assert.notEqual(db.transfers[0].deleted, true, 'لا يجوز حذف التحويل عند فتحه');

  // مغادرة الصفحة والعودة إلى renderTransfers -> التحويلان يبقيان ظاهرين
  const htmlAgent = envAgent.sandbox.renderTransfers();
  assert.ok(htmlAgent.includes('غياب متكرر'), 'اختفى تحويل الوكيلة بعد فتحه');
  assert.ok(htmlAgent.includes('تمت المشاهدة'), 'لم تظهر حالة تمت المشاهدة');

  // الموجهة تفتح التحويل الموجه لها
  const envCoun = loadClientTransferEnv(COUNSELOR, db);
  assert.equal(envCoun.sandbox.transferStatusInfo(db.transfers[1]).label, 'جديد');
  envCoun.sandbox.openTransferDetails('t_cn');
  assert.equal(envCoun.sandbox.transferStatusInfo(db.transfers[1]).label, 'تمت المشاهدة');
  const htmlCoun = envCoun.sandbox.renderTransfers();
  assert.ok(htmlCoun.includes('متابعة سلوكية'), 'اختفى تحويل الموجهة بعد فتحه');
});

test('2) التحويلات تبقى ظاهرة عبر تغيّر الحالات (جديد -> تمت المشاهدة -> قيد المعالجة -> مكتمل)', () => {
  const AGENT = { id: 'ag1', name: 'الوكيلة', role: 'AGENT' };
  const db = {
    users: [AGENT],
    students: [{ id: 's1', fullName: 'نورة خالد', classId: 'c1', active: true }],
    transfers: [
      { id: 't1', studentIds: ['s1'], studentId: 's1', target: 'AGENT', priority: 'URGENT', reason: 'تأخر صباحي', status: 'PENDING', createdBy: 'adm1', createdAt: '2026-11-24T07:00:00.000Z' }
    ]
  };
  const env = loadClientTransferEnv(AGENT, db);
  assert.equal(env.sandbox.transferStatusInfo(db.transfers[0]).label, 'جديد');

  env.sandbox.openTransferDetails('t1');
  assert.equal(env.sandbox.transferStatusInfo(db.transfers[0]).label, 'تمت المشاهدة');

  env.sandbox.setTransferInProgress('t1');
  assert.equal(env.sandbox.transferStatusInfo(db.transfers[0]).label, 'قيد المعالجة');
  assert.ok(env.sandbox.renderTransfers().includes('تأخر صباحي'));

  db.transfers[0].status = 'RESOLVED';
  db.transfers[0].solution = 'تم التواصل مع ولي الأمر';
  assert.equal(env.sandbox.transferStatusInfo(db.transfers[0]).label, 'مكتمل');
  assert.ok(env.sandbox.renderTransfers().includes('تم التواصل مع ولي الأمر'));
});

test('3) تحديث الصفحة وإعادة تسجيل الدخول: الخادم و__mergeTransfersPull يحافظان على التحويل وحالة المشاهدة', () => {
  const mergeTransfers = loadServerMergeTransfers();
  const AGENT = { id: 'ag1', user_id: 'ag1', name: 'الوكيلة', role: 'AGENT' };
  const COUNSELOR = { id: 'cn1', user_id: 'cn1', name: 'الموجهة', role: 'COUNSELOR' };

  const prevServer = [
    { id: 't1', studentIds: ['s1'], target: 'AGENT', reason: 'غياب', status: 'PENDING', createdBy: 'adm1', createdAt: '2026-11-24T08:00:00.000Z' }
  ];
  const incomingWithView = [
    { id: 't1', studentIds: ['s1'], target: 'AGENT', reason: 'غياب', status: 'IN_PROGRESS', createdBy: 'adm1', createdAt: '2026-11-24T08:00:00.000Z', viewedAt: '2026-11-24T08:05:00.000Z', viewedBy: { ag1: { name: 'الوكيلة', role: 'AGENT', at: '2026-11-24T08:05:00.000Z' } } }
  ];

  // دمج الخادم
  const mergedSrv = mergeTransfers(prevServer, incomingWithView);
  assert.equal(mergedSrv.length, 1);
  assert.equal(mergedSrv[0].status, 'IN_PROGRESS');
  assert.ok(mergedSrv[0].viewedBy.ag1);

  // التحقق من صلاحية الرؤية عند إعادة تسجيل الدخول للوكيل والموجه
  assert.equal(transferPrivacy.filterTransfersForViewer(mergedSrv, AGENT).length, 1);
  assert.equal(transferPrivacy.filterTransfersForViewer(mergedSrv, COUNSELOR).length, 1);

  // دمج السحب في العميل لا يفقد المشاهدة أو التحويل
  const env = loadClientTransferEnv(AGENT, { users: [AGENT], students: [], transfers: [] });
  const pulled = env.sandbox.__mergeTransfersPull(incomingWithView, prevServer);
  assert.equal(pulled.length, 1);
  assert.equal(pulled[0].status, 'IN_PROGRESS');
  assert.ok(pulled[0].viewedBy.ag1);
});

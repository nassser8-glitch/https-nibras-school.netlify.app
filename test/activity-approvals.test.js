'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const serverSrc = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const indexSrc = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

test('1. مسار تقديم طلب مشاركة المعلمة وحفظه بحالة بانتظار اعتماد المديرة', () => {
  assert.match(serverSrc, /app\.post\('\/api\/activities\/:school\/:id\/requests'/);
  assert.match(serverSrc, /status:\s*'PENDING'/);
  assert.match(serverSrc, /action:\s*'SUBMITTED'/);
  assert.match(serverSrc, /action:\s*'RESUBMITTED'/);
  assert.match(serverSrc, /request_already_exists/);
});

test('2. حصر قرار الاعتماد والرفض والاستكمال في المديرة فقط على الخادم', () => {
  assert.match(serverSrc, /app\.post\('\/api\/activities\/:school\/:id\/requests\/:reqId\/decision'/);
  assert.match(serverSrc, /if \(req\.session\.role !== 'ADMIN'\) return res\.status\(403\)/);
  assert.match(serverSrc, /\['APPROVED', 'REJECTED', 'NEEDS_INFO'\]\.includes\(decision\)/);
  assert.match(serverSrc, /decision_note_required/);
  assert.match(serverSrc, /target\.decidedByName = adminName/);
  assert.match(serverSrc, /target\.auditLog\.push/);
});

test('3. منع المعلمة من اعتماد مشاركتها أو تعديل قرار المديرة عبر المزامنة العامة', () => {
  assert.match(serverSrc, /if \(String\(existing\.teacherId \|\| ''\) !== uid\) continue;/);
  assert.match(serverSrc, /if \(existing\.status === 'NEEDS_INFO' && r\.status === 'PENDING'\)/);
});

test('4. واجهة اعتماد مشاركات المعلمات وحالات الطلب الأربع للمديرة والمعلمة', () => {
  assert.match(indexSrc, /renderAdminActivityApprovals/);
  assert.match(indexSrc, /اعتماد مشاركات المعلمات/);
  assert.match(indexSrc, /actReqStatusMeta/);
  assert.match(indexSrc, /بانتظار اعتماد المديرة/);
  assert.match(indexSrc, /بحاجة إلى استكمال/);
  assert.match(indexSrc, /openActDecisionModal/);
  assert.match(indexSrc, /submitActDecision/);
});

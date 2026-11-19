'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const CLIENT = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

function extractFn(src, name) {
  const token = 'function ' + name + '(';
  const idx = src.indexOf(token);
  if (idx < 0) throw new Error('fn not found: ' + name);
  let i = src.indexOf('{', idx);
  let depth = 0;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return src.slice(idx, i + 1);
    }
  }
  throw new Error('unbalanced fn: ' + name);
}

test('1) الخادم يحتوي مسار POST /api/auth/admin/delete-user محصورًا بالمدير ويُعطّل الحساب والجلسات ويضيف _blockedUsers', () => {
  const idx = SERVER.indexOf("app.post('/api/auth/admin/delete-user'");
  assert.ok(idx > 0, 'مسار delete-user مفقود');
  const block = SERVER.slice(idx, idx + 2200);
  assert.ok(block.includes("if (req.session.role !== 'ADMIN') return res.status(403)"), 'يجب حصر المسار بالمدير');
  assert.ok(block.includes('cannot_delete_self'), 'يجب منع حذف المدير لنفسه');
  assert.ok(block.includes('cannot_delete_admin'), 'يجب منع حذف حساب مدير');
  assert.ok(block.includes('db.setUserActive(id, false)'), 'يجب تعطيل الحساب في جدول users');
  assert.ok(block.includes('db.deleteUserSessions(id)'), 'يجب إنهاء جلسات الحساب');
  assert.ok(block.includes('d._blockedUsers'), 'يجب تسجيل المعرّف في _blockedUsers');
  assert.ok(block.includes('t.deleted = true'), 'يجب وسم الحساب بـ deleted: true');
});

test('2) دالة applyBlockedUsers تمنع عودة أي حساب محذوف حتى لو أرسله جهاز قديم بحالة active=true', () => {
  const fnCode = extractFn(SERVER, 'applyBlockedUsers');
  const ctx = { FORCE_ACTIVE: new Set(['id_force']), console };
  vm.createContext(ctx);
  vm.runInContext(fnCode + '\nglobalThis.applyBlockedUsers = applyBlockedUsers;', ctx);

  const data = {
    _blockedUsers: ['u_dup1', 'u_dup2', 'u_admin', 'id_force'],
    users: [
      { id: 'u_good', name: 'طيف', username: 'taif12', role: 'COUNSELOR', active: true },
      { id: 'u_dup1', name: 'طيف مكرر 1', username: 'taif22', role: 'AGENT', active: true },
      { id: 'u_dup2', name: 'طيف مكرر 2', username: 'taif33', role: 'COUNSELOR', active: true },
      { id: 'u_admin', name: 'المدير', username: 'admin', role: 'ADMIN', active: true },
      { id: 'id_force', name: 'محمي', username: 'force1', role: 'TEACHER', active: true },
    ],
  };

  const changed = ctx.applyBlockedUsers(data);
  assert.equal(changed, true);
  assert.equal(data.users.find(u => u.id === 'u_good').active, true);
  assert.equal(data.users.find(u => u.id === 'u_dup1').active, false);
  assert.equal(data.users.find(u => u.id === 'u_dup1').deleted, true);
  assert.equal(data.users.find(u => u.id === 'u_dup2').active, false);
  assert.equal(data.users.find(u => u.id === 'u_dup2').deleted, true);
  assert.equal(data.users.find(u => u.id === 'u_admin').active, true, 'حساب المدير لا يُحظر');
  assert.equal(data.users.find(u => u.id === 'id_force').active, true, 'حساب FORCE_ACTIVE لا يُحظر');
});

test('3) حارس اسم المستخدم في PUT يتجاهل الحسابات المحذوفة/المعطّلة فلا يعرقل حذف الأسماء المكررة', () => {
  const idx = SERVER.indexOf('for (const nu of (clean.users || []))');
  assert.ok(idx > 0);
  const snippet = SERVER.slice(idx, idx + 220);
  assert.ok(snippet.includes('if (!nu || nu.deleted || nu.active === false) continue;'), 'يجب تخطي الحسابات المحذوفة/المعطّلة');
});

test('4) الواجهة deleteUser تثبّت deleted=true و_blockedUsers وتستدعي admin/delete-user على الخادم', () => {
  const fnCode = extractFn(CLIENT, 'deleteUser');
  const apiCalls = [];
  let saved = null;
  const ctx = {
    userById: () => ({ id: 'u_dup1', name: 'طيف مكرر' }),
    confirm: () => true,
    getActiveSchool: () => 'GIRLS',
    loadDB: () => ({ users: [{ id: 'u_dup1', name: 'طيف مكرر', active: true }] }),
    saveDB: (d) => { saved = d; },
    __serverEnabled: () => true,
    __syncEnabled: () => true,
    __saveGuardWatch: () => {},
    __saveGuardOutcome: () => {},
    __noteSaveBanner: () => {},
    __refreshSaveStatus: () => {},
    __syncSchedule: () => {},
    __api: (m, ep, body) => { apiCalls.push({ m, ep, body }); return Promise.resolve({ status: 200, j: { ok: true } }); },
    renderApp: () => {},
  };
  vm.createContext(ctx);
  vm.runInContext(fnCode + '\nglobalThis.deleteUser = deleteUser;', ctx);
  ctx.deleteUser('u_dup1');

  assert.equal(saved.users[0].active, false);
  assert.equal(saved.users[0].deleted, true);
  assert.ok(saved._blockedUsers.includes('u_dup1'));
  assert.equal(apiCalls.length, 1);
  assert.equal(apiCalls[0].ep, 'admin/delete-user');
  assert.equal(apiCalls[0].body.userId, 'u_dup1');
});

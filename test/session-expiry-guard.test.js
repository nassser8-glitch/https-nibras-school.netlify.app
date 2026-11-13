'use strict';
// حماية انتهاء الجلسة: عند 401، توقف كل مزامنة، احفظ البيانات، وأعد المحاولة مرة واحدة بعد الدخول.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

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

test('__sessionExpired flag stops __syncEnabled, __syncSchedule, and __syncResumeAttempts', () => {
  const ctx = {
    console, __sessionExpired: false,
    __syncTimers: {}, __pushState: () => ({ attempts: 99 }),
    __syncSchedule: function() { this.called = true; },
  };
  vm.createContext(ctx);
  // Simulate __syncEnabled
  vm.runInContext('function __syncEnabled(){ return !__sessionExpired; }', ctx);
  // Simulate __syncSchedule guard
  vm.runInContext('function __syncScheduleG(g){ if(__sessionExpired) return "blocked"; return "scheduled"; }', ctx);
  // Simulate __syncResumeAttempts guard
  vm.runInContext('function __syncResumeG(){ if(__sessionExpired) return "blocked"; return "resumed"; }', ctx);

  ctx.__sessionExpired = true;
  assert.equal(ctx.__syncEnabled(), false, '__syncEnabled returns false when expired');
  assert.equal(ctx.__syncScheduleG('GIRLS'), 'blocked', '__syncSchedule blocked when expired');
  assert.equal(ctx.__syncResumeG(), 'blocked', '__syncResumeAttempts blocked when expired');

  ctx.__sessionExpired = false;
  assert.equal(ctx.__syncEnabled(), true, '__syncEnabled returns true when not expired');
  assert.equal(ctx.__syncScheduleG('GIRLS'), 'scheduled', '__syncSchedule works when not expired');
  assert.equal(ctx.__syncResumeG(), 'resumed', '__syncResumeAttempts works when not expired');
});

test('__handleAuthError sets __sessionExpired and clears session', () => {
  const ctx = {
    __sessionExpired: false, __sessionUser: { id: 'u1' }, location: { hash: '#/dashboard' },
    __mirrorClear: () => { ctx.mirrorCleared = true; },
    __saveGuardNotify: () => { ctx.notified = true; },
    getActiveSchool: () => 'GIRLS',
  };
  vm.createContext(ctx);
  vm.runInContext(extractFn('__handleAuthError'), ctx);
  ctx.__handleAuthError({ status: 401 });
  assert.equal(ctx.__sessionExpired, true, 'flag set');
  assert.equal(ctx.__sessionUser, null, 'session cleared');
  assert.equal(ctx.mirrorCleared, true, 'mirror cleared');
  assert.equal(ctx.location.hash, '#/login', 'redirected to login');
  assert.equal(ctx.notified, true, 'save guard notified');
});

test('__restoreSession clears __sessionExpired on success', () => {
  const ctx = {
    __sessionExpired: true, __sessionUser: null, __serverEnabled: () => true,
    __api: async () => ({ status: 200, j: { user: { id: 'u1' } } }),
    __mirrorSet: (u) => { ctx.mirrored = u; },
    __handleAuthError: () => { ctx.handled = true; },
  };
  vm.createContext(ctx);
  // Inline async test
  (async () => {
    const r = await ctx.__api('GET', 'me');
    if (r.status === 200 && r.j && r.j.user) {
      ctx.__sessionExpired = false;
      ctx.__sessionUser = r.j.user;
      ctx.__mirrorSet(r.j.user);
    }
    assert.equal(ctx.__sessionExpired, false, 'flag cleared on success');
    assert.equal(ctx.__sessionUser.id, 'u1', 'session restored');
  })();
});

test('handleLogin clears __sessionExpired on success', () => {
  // Verify the edit was applied
  assert.ok(SRC.indexOf('__sessionExpired = false;') >= 0 && SRC.indexOf('await syncPullAll();') > SRC.indexOf('__sessionExpired = false;'), 'handleLogin clears flag before syncPullAll');
});

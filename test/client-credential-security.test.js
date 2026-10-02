'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

function extractFunction(name) {
  const marker = 'function ' + name + '(';
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, name + ' exists');
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unclosed function ' + name);
}

test('server session identity is not persisted in browser storage', () => {
  const context = vm.createContext({
    __serverEnabled: () => true,
    __sessionUser: null
  });
  vm.runInContext(extractFunction('currentUser'), context);
  assert.equal(context.currentUser(), null);
  assert.doesNotMatch(source, /function __mirror(Set|Get)/);
  assert.match(source, /sessionStorage\.removeItem\('nibras_secure_session_v1'\)/);
});

test('sync diagnostics persist only event and aggregate metadata', () => {
  const values = new Map();
  const context = vm.createContext({
    __SYNC_LOG_KEY: 'sync-log',
    localStorage: {
      getItem: key => values.get(key) || null,
      setItem: (key, value) => values.set(key, value)
    }
  });
  vm.runInContext(extractFunction('__syncLogAdd'), context);
  context.__syncLogAdd({
    ev: 'note-saved', count: 2, school: 'GIRLS', by: 'user-1',
    byName: 'معلمة', studentId: 'student-1', batch: 'batch-1',
    description: 'private note'
  });

  const [saved] = JSON.parse(values.get('sync-log'));
  assert.deepEqual(Object.keys(saved).sort(), ['at', 'count', 'ev']);
  assert.equal(saved.count, 2);
  assert.equal(saved.byName, undefined);
});

test('local teacher password reset uses cryptographic randomness only', () => {
  const start = source.indexOf('async function resetTeacherSecret(');
  const end = source.indexOf('async function markUserActivated(', start);
  assert.ok(start !== -1 && end > start, 'reset function found');
  const reset = source.slice(start, end);
  assert.match(reset, /crypto\.getRandomValues/);
  assert.doesNotMatch(reset, /Math\.random/);
});

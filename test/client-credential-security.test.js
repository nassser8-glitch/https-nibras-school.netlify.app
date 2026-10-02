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

test('session mirror stores only non-sensitive display/session fields', () => {
  const values = new Map();
  const context = vm.createContext({
    SESS_MIRROR_KEY: 'mirror',
    sessionStorage: {
      setItem: (key, value) => values.set(key, value)
    }
  });
  vm.runInContext(extractFunction('__mirrorSet'), context);
  context.__mirrorSet({
    id: 'U1', name: 'معلمة', role: 'TEACHER', active: true,
    plain_password: 'must-not-persist', password: 'also-secret',
    resetCode: 'temporary-secret', privateField: 'not-needed'
  });

  const saved = JSON.parse(values.get('mirror'));
  assert.deepEqual(Object.keys(saved).sort(), ['active', 'id', 'name', 'role']);
  assert.equal(saved.plain_password, undefined);
  assert.equal(saved.password, undefined);
});

test('local teacher password reset uses cryptographic randomness only', () => {
  const start = source.indexOf('async function resetTeacherSecret(');
  const end = source.indexOf('async function markUserActivated(', start);
  assert.ok(start !== -1 && end > start, 'reset function found');
  const reset = source.slice(start, end);
  assert.match(reset, /crypto\.getRandomValues/);
  assert.doesNotMatch(reset, /Math\.random/);
});

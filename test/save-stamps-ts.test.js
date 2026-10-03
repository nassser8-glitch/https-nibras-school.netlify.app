'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

function extractFn(name) {
  const start = SRC.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('function not found in index.html: ' + name);
  const open = SRC.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}' && --depth === 0) return SRC.slice(start, i + 1);
  }
  throw new Error('unterminated function in index.html: ' + name);
}

function makeSaveDB({ initial = null, now = 1000, demo = false } = {}) {
  const writes = [];
  const values = new Map();
  if (initial !== null) values.set('db', JSON.stringify(initial));
  const context = {
    Array, Date, JSON, Math, Number, Object,
    DEMO_MODE: demo,
    window: { __demoLSOverridden: false },
    dbKey: () => 'db',
    localStorage: {
      getItem: key => values.get(key) || null,
      setItem: (key, value) => { writes.push([key, value]); values.set(key, value); },
    },
  };
  vm.createContext(context);
  vm.runInContext(extractFn('__canon'), context);
  vm.runInContext(extractFn('__canonNoTs'), context);
  vm.runInContext(extractFn('saveDB'), context);
  context.Date.now = () => now;
  return {
    save: data => vm.runInContext('saveDB(__input)', Object.assign(context, { __input: data })),
    read: () => JSON.parse(values.get('db') || 'null'),
    writes,
  };
}

test('saveDB stamps a newly created database', () => {
  const db = makeSaveDB();
  const data = { students: [] };
  db.save(data);
  assert.equal(data._ts, 1000);
  assert.equal(db.read()._ts, 1000);
});

test('saveDB refreshes the stamp when content changes', () => {
  const db = makeSaveDB({ initial: { _ts: 100, students: [{ id: 'a' }] } });
  db.save({ _ts: 100, students: [{ id: 'a' }, { id: 'b' }] });
  assert.equal(db.read()._ts, 1000);
});

test('saveDB stamps a deletion as a real content change', () => {
  const db = makeSaveDB({ initial: { _ts: 100, transfers: [{ id: 't1' }] } });
  db.save({ _ts: 100, transfers: [] });
  assert.deepEqual(db.read().transfers, []);
  assert.equal(db.read()._ts, 1000);
});

test('saveDB does not write or change the stamp for identical content', () => {
  const db = makeSaveDB({ initial: { _ts: 100, students: [{ id: 'a' }] } });
  const same = { _ts: 99, students: [{ id: 'a' }] };
  db.save(same);
  assert.equal(db.writes.length, 0);
  assert.equal(same._ts, 99);
  assert.equal(db.read()._ts, 100);
});

test('saveDB advances the stamp when multiple edits happen in the same millisecond', () => {
  const db = makeSaveDB({ initial: { _ts: 1000, students: [] } });
  db.save({ _ts: 1000, students: [{ id: 'a' }] });
  assert.equal(db.read()._ts, 1001);
});

test('saveDB does not move a future stamp backwards', () => {
  const db = makeSaveDB({ initial: { _ts: 5000, students: [] } });
  db.save({ _ts: 4000, students: [{ id: 'a' }] });
  assert.equal(db.read()._ts, 5001);
});

test('saveDB keeps the demo-mode write guard', () => {
  const db = makeSaveDB({ demo: true });
  db.save({ students: [] });
  assert.equal(db.writes.length, 0);
  assert.equal(db.read(), null);
});

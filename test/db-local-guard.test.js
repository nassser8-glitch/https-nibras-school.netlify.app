'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

// Mock pg so no network/socket is ever opened during unit tests
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, parent, isMain, opts) {
  if (req === 'pg') return '__fake_pg_guard__';
  return origResolve.call(this, req, parent, isMain, opts);
};
require.cache['__fake_pg_guard__'] = {
  id: '__fake_pg_guard__', filename: '__fake_pg_guard__', loaded: true,
  exports: { Pool: class { constructor(cfg) { this.cfg = cfg; } async connect() { throw new Error('Should not connect in guard test'); } } },
};

const DB_PATH = path.join(__dirname, '..', 'db.js');
function loadDbWithEnv(envOverrides) {
  const keys = ['DATABASE_URL', 'NODE_ENV', 'NIBRAS_REQUIRE_GIRLS_DB'];
  const prev = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  try {
    for (const k of keys) {
      if (envOverrides[k] === undefined) delete process.env[k];
      else process.env[k] = envOverrides[k];
    }
    delete require.cache[DB_PATH];
    return require(DB_PATH);
  } finally {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k];
    }
  }
}

const LOCAL_URL = 'postgres://postgres:secret@127.0.0.1:5433/nibras_girls_local';
const NEON_HOST = 'ep-bitter-rice-aerhp71v-pooler.c-2.us-east-2.aws.neon.tech';
const NEON_URL = `postgresql://user:secret@${NEON_HOST}:5432/neondb?sslmode=require`;

test('1) قسم GIRLS فقط مع السماح بقاعدة اختبار محلية محددة', () => {
  const db = loadDbWithEnv({});
  assert.deepEqual(db.SCHOOLS, ['GIRLS']);
  assert.equal(db.REQUIRED_DB_NAME, 'nibras_girls_local');
  assert.equal(db.ALLOWED_DB_HOST, '127.0.0.1');
  assert.equal(db.ALLOWED_DB_PORT, '5433');
  assert.equal(db.PRODUCTION_DB_NAME, 'neondb');
  assert.equal(db.PRODUCTION_DB_HOST, NEON_HOST);
  assert.equal(db.PRODUCTION_DB_PORT, '5432');
});

test('2) السماح بقاعدة البنات المحلية المحددة فقط خارج الإنتاج', () => {
  const db = loadDbWithEnv({ DATABASE_URL: LOCAL_URL });
  const res = db.validateDatabaseUrl(LOCAL_URL);
  assert.equal(res.host, '127.0.0.1');
  assert.equal(res.port, '5433');
  assert.equal(res.name, 'nibras_girls_local');
  assert.equal(res.environment, 'local');
});

test('3) السماح بقاعدة Neon المخصصة لتطبيق البنات فقط في الإنتاج', () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const db = loadDbWithEnv({ DATABASE_URL: NEON_URL, NODE_ENV: 'production' });
    const res = db.validateDatabaseUrl(NEON_URL);
    assert.equal(res.host, NEON_HOST);
    assert.equal(res.port, '5432');
    assert.equal(res.name, 'neondb');
    assert.equal(res.environment, 'production');
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous;
  }
});

test('4) منع الاتصال بقواعد البنين', () => {
  for (const name of ['nibras_boys_psay', 'nibras_boys_local']) {
    const url = `postgres://user:secret@127.0.0.1:5433/${name}`;
    assert.throws(() => loadDbWithEnv({ DATABASE_URL: url }), /boys database.*strictly forbidden/i);
  }
});

test('5) رفض مضيف أو اسم قاعدة Neon غير المعتمد في الإنتاج', () => {
  assert.throws(
    () => loadDbWithEnv({ DATABASE_URL: 'postgres://user:secret@other.neon.tech:5432/neondb?sslmode=require', NODE_ENV: 'production' }),
    /approved girls Neon host/i
  );
  assert.throws(
    () => loadDbWithEnv({ DATABASE_URL: `postgres://user:secret@${NEON_HOST}:5432/nibras_prod?sslmode=require`, NODE_ENV: 'production' }),
    /approved girls Neon host/i
  );
  assert.throws(
    () => loadDbWithEnv({ DATABASE_URL: `postgres://user:secret@${NEON_HOST}:5432/neondb`, NODE_ENV: 'production' }),
    /must require SSL/i
  );
});

test('6) منع المضيف أو المنفذ أو اسم قاعدة محلية غير معتمد', () => {
  assert.throws(() => loadDbWithEnv({ DATABASE_URL: 'postgres://user:secret@localhost:5433/nibras_girls_local' }), /127\.0\.0\.1:5433/i);
  assert.throws(() => loadDbWithEnv({ DATABASE_URL: 'postgres://user:secret@127.0.0.1:5432/nibras_girls_local' }), /127\.0\.0\.1:5433/i);
  assert.throws(() => loadDbWithEnv({ DATABASE_URL: 'postgres://user:secret@127.0.0.1:5433/nibras_girls_prod' }), /nibras_girls_local/i);
});

test('7) رفض بدء initSchema إذا لم يُحدَّد DATABASE_URL', async () => {
  const db = loadDbWithEnv({});
  await assert.rejects(async () => { await db.initSchema(); }, /DATABASE_URL must be explicitly set/i);
});

test('8) رفض بدء التطبيق في الإنتاج إذا غاب DATABASE_URL', () => {
  assert.throws(() => loadDbWithEnv({ NODE_ENV: 'production' }), /DATABASE_URL is required/i);
});

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const db = require('../db');

test('finalizeLogin clears first_login and the mirrored firstLogin flag atomically', async () => {
  const originalQuery = db.pool.query;
  let sql = '';
  let params;
  db.pool.query = async (query, values) => {
    sql = query;
    params = values;
    return { rows: [{ created_at: 'created', expires_at: 'expires' }] };
  };
  try {
    const row = await db.finalizeLogin(
      'teacher-1', 'GIRLS', 'token-hash', 3600000, '127.0.0.1', 'test-agent',
      { lastLogin: '2026-09-22T00:00:00.000Z', loginCount: 1, loginHistory: ['2026-09-22T00:00:00.000Z'] },
      1, '2026-09-22T00:00:00.000Z', ['2026-09-22T00:00:00.000Z'],
    );
    assert.deepEqual(row, { created_at: 'created', expires_at: 'expires' });
    assert.match(sql, /SET data = \$4::jsonb, first_login = false/);
    assert.match(sql, /'firstLogin', to_jsonb\(false\)/);
    assert.equal(params[0], 'teacher-1');
    assert.equal(params[1], 'GIRLS');
  } finally {
    db.pool.query = originalQuery;
  }
});

test('first-login repair selects only teachers with login evidence', async () => {
  const originalQuery = db.pool.query;
  db.pool.query = async () => ({ rows: [{ id: 'teacher-1' }, { id: 'teacher-2' }] });
  try {
    const result = await db.repairTeacherFirstLoginFromEvidence('GIRLS', false);
    assert.deepEqual(result, { candidateIds: ['teacher-1', 'teacher-2'], updatedIds: [] });
  } finally {
    db.pool.query = originalQuery;
  }
});

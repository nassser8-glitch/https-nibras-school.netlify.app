'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

test('all star mutation methods authenticate and share the ADMIN-only handler', () => {
  const source = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  for (const method of ['post', 'put', 'patch'])
    assert.ok(source.includes(`app.${method}('/api/stars/award', requireAuth, requireStarAdmin, starWriteRateLimit, saveStarAward)`), method);
  assert.ok(source.includes("if (req.session.role !== 'ADMIN') return res.status(403)"), 'server checks role');
  assert.ok(source.includes("app.delete('/api/stars/award', requireAuth, requireStarAdmin, starWriteRateLimit"), 'DELETE route has shared protections');
});

test('star mutation updates only the existing school JSON stars array under its row lock', () => {
  const source = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const start = source.indexOf('const saveStarAward');
  const end = source.indexOf("app.post('/api/stars/award'", start);
  const handler = source.slice(start, end);
  assert.ok(handler.includes('db.mutateSchoolData'), 'uses atomic targeted mutation');
  assert.ok(handler.includes('fresh.stars = o.stars'), 'only stars is assigned');
  assert.ok(!handler.includes('db.setSchoolData('), 'does not replace the full school record');
});

test('the common session ID accepts the actual database session shape', () => {
  const sw = require(path.join(ROOT, 'star-week.js'));
  assert.equal(sw.sessionUserId({ user_id: 'A1', role: 'ADMIN' }), 'A1');
});

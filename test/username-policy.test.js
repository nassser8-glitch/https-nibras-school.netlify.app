'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const policy = require(path.join(ROOT, 'username-policy.js'));
const db = require(path.join(ROOT, 'db.js'));
const serverSrc = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const indexSrc = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

test('1. السماح بحساب قديم يحمل اسم المستخدم fy عند وجوده في نسخة القسم أو جدول users', () => {
  const fromPrev = policy.checkSyncUsername({ uname: 'fy', prevSchoolUname: 'fy', dbUserUname: '' });
  assert.equal(fromPrev.ok, true);
  assert.equal(fromPrev.unchanged, true);

  const fromDbOnly = policy.checkSyncUsername({ uname: 'fy', prevSchoolUname: '', dbUserUname: 'fy' });
  assert.equal(fromDbOnly.ok, true);
  assert.equal(fromDbOnly.unchanged, true);

  assert.match(serverSrc, /dbUnameMap\.get\(nu\.id\)/);
  assert.match(serverSrc, /isValidLegacyUsername\(uname\)/);
});

test('2. إنشاء حساب جديد وتوليد اسم مستخدم آمن لا يقل عن 3 رموز', () => {
  assert.equal(policy.isValidNewUsername('fy'), false);
  assert.equal(policy.isValidNewUsername('a b'), false);
  assert.equal(policy.isValidNewUsername('sara.2026'), true);

  const gen = db.baseUsername('في');
  assert.ok(gen.length >= 3, 'baseUsername("في") يجب ألا يقل عن 3 أحرف، القيمة: ' + gen);
  assert.match(gen, /^[a-z0-9._-]{3,32}$/);

  const rejectNewShort = policy.checkSyncUsername({ uname: 'ab', prevSchoolUname: 'olduser', dbUserUname: 'olduser' });
  assert.equal(rejectNewShort.ok, false);
  assert.equal(rejectNewShort.error, 'username_invalid');
});

test('3. تعديل بيانات حساب قديم (الاسم فقط دون تغيير fy) مسموح في الواجهة والخادم', () => {
  assert.match(indexSrc, /if\(userChanged && !\/\^\[a-z0-9\._-\]\{3,32\}\$\/\.test\(cleanUser\)\)/);
  const keepLegacy = policy.checkSyncUsername({ uname: 'FY', prevSchoolUname: 'fy', dbUserUname: 'fy' });
  assert.equal(keepLegacy.ok, true);
  assert.equal(keepLegacy.unchanged, true);
});

test('4. عدم إعادة المحاولة المستمرة على 400/409 والاحتفاظ بالبيانات محلياً', () => {
  assert.match(indexSrc, /if\(resp\.status === 400 \|\| resp\.status === 409\)\{ nonRetryable = true; return null; \}/);
  assert.match(indexSrc, /if\(nonRetryable\)/);
});

test('5 & 6. قبول الدخول للحسابات القديمة وعدم السماح بالتكرار', () => {
  assert.equal(policy.isValidLegacyUsername('fy'), true);
  assert.equal(policy.normalizeUsername(' FY '), 'fy');
  assert.match(serverSrc, /if \(seenLocal\.has\(uname\)\)/);
  assert.match(serverSrc, /username_taken/);
});

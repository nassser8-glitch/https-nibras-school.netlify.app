'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const policy = require(path.join(ROOT, 'phone-policy.js'));
const serverSrc = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const indexSrc = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

test('1. حصر صلاحية تعديل الجوال الذاتي في الإداري والموجه الطلابي فقط', () => {
  assert.equal(policy.canSelfEditPhone('ADMINISTRATIVE'), true);
  assert.equal(policy.canSelfEditPhone('COUNSELOR'), true);
  assert.equal(policy.canSelfEditPhone('TEACHER'), false);
  assert.equal(policy.canSelfEditPhone('STUDENT'), false);
  assert.equal(policy.canSelfEditPhone('ADMIN'), false);
  assert.equal(policy.canSelfEditPhone('AGENT'), false);
});

test('2. التحقق من صحة أرقام الجوال المحلية والدولية ورفض الفارغ أو غير الصالح', () => {
  assert.deepEqual(policy.validatePhone('0501234567'), { ok: true, phone: '0501234567' });
  assert.deepEqual(policy.validatePhone('+966 50-123-4567'), { ok: true, phone: '+966501234567' });
  assert.deepEqual(policy.validatePhone('٠٥٠١٢٣٤٥٦٧'), { ok: true, phone: '0501234567' });
  assert.equal(policy.validatePhone('').ok, false);
  assert.equal(policy.validatePhone('   ').error, 'phone_required');
  assert.equal(policy.validatePhone('1234').error, 'invalid_phone');
  assert.equal(policy.validatePhone('abc1234567').error, 'invalid_phone');
});

test('3. التحقق من ضوابط الخادم: منع تعديل حساب الغير وحفظ الرقم في قاعدة البيانات', () => {
  assert.match(serverSrc, /app\.post\('\/api\/auth\/update-phone', requireAuth/);
  assert.match(serverSrc, /if \(!phonePolicy\.canSelfEditPhone\(me\.role\)\) return res\.status\(403\)/);
  assert.match(serverSrc, /if \(targetId && String\(targetId\) !== String\(me\.id\)\) return res\.status\(403\)/);
  assert.match(serverSrc, /await db\.updateUserProfile\(me\.id, \{ data: nextData \}\)/);
  assert.match(serverSrc, /await updateSchoolUser\(me\.school, me\.id, \{ phone: v\.phone \}\)/);
});

test('4. ظهور واجهة تعديل رقم الجوال في الملف الشخصي للإداريين والموجهين فقط', () => {
  assert.match(indexSrc, /\(user\.role === 'ADMINISTRATIVE' \|\| user\.role === 'COUNSELOR'\)/);
  assert.match(indexSrc, /id="accPhone"/);
  assert.match(indexSrc, /saveAccountPhone\(\)/);
  assert.match(indexSrc, /id="accPhoneMsg"/);
});

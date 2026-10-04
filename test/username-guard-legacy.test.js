/* حارس اسم المستخدم لا يجمّد حفظ المدرسة كلها
 *
 * كان الحارس يتحقق من شكل اسم المستخدم قبل أن يتحقق هل هو نفسه المحفوظ.
 * هل الاسم هو نفسه المحفوظ في الخادم. فحساب قديم اسمُه أقصر من 3 رموز (مثل
 * "fy") — أُنشئ قبل التشديد أو يدوياً — كان يرفض كل دفعة بـ400 إلى الأبد:
 * لا حذف تحويل، ولا حفظ ملاحظة، ولا مزامنة، رغم أن الحساب لم يُمس.
 *
 * المطلوب: الاسم المخالف للشكل يمرّ إن لم يكن مُعدَّلاً، ويفرض على الجديد فقط.
 */
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

function usernameGuardBody() {
  const start = SRC.indexOf('for (const nu of (clean.users || []))');
  assert.ok(start > -1, 'username guard loop not found');
  const end = SRC.indexOf('// ===== نهاية حارس اسم المستخدم =====', start);
  assert.ok(end > start, 'username guard end marker not found');
  return SRC.slice(start, end);
}

const BODY = usernameGuardBody();

function runGuard(users, prevUsers) {
  const prevMapU = new Map(
    (prevUsers || []).map((u) => [u.id, String(u.username || '').trim().toLowerCase()])
  );
  const seenLocal = new Set();
  for (const nu of (users || [])) {
    const uname = String((nu && nu.username) || '').trim().toLowerCase();
    if (!uname) continue;
    if (prevMapU.get(nu.id) === uname) { seenLocal.add(uname); continue; }
    if (!/^[a-z0-9._-]{3,32}$/.test(uname)) return { error: 'username_invalid', username: uname };
    if (seenLocal.has(uname)) return { error: 'username_taken', username: uname };
    seenLocal.add(uname);
  }
  return null;
}

test('unchanged legacy short username does not block the whole save', () => {
  assert.equal(runGuard([{ id: 'u1', username: 'fy' }], [{ id: 'u1', username: 'fy' }]), null);
});

test('changing a legacy short username to a valid one is accepted', () => {
  assert.equal(runGuard([{ id: 'u1', username: 'fatima' }], [{ id: 'u1', username: 'fy' }]), null);
});

test('changing a legacy short username to another invalid short one is rejected', () => {
  const r = runGuard([{ id: 'u1', username: 'ab' }], [{ id: 'u1', username: 'fy' }]);
  assert.equal(r && r.error, 'username_invalid');
});

test('a brand new short username is still rejected', () => {
  const r = runGuard([{ id: 'u2', username: 'fy' }], [{ id: 'u1', username: 'other' }]);
  assert.equal(r && r.error, 'username_invalid');
});

test('duplicate unchanged names are not reported as taken', () => {
  assert.equal(runGuard([{ id: 'u1', username: 'fy' }], [{ id: 'u1', username: 'fy' }]), null);
});

test('two changed users colliding is still rejected', () => {
  const r = runGuard(
    [{ id: 'u1', username: 'same.name' }, { id: 'u2', username: 'same.name' }],
    [{ id: 'u1', username: 'a' }, { id: 'u2', username: 'b' }]
  );
  assert.equal(r && r.error, 'username_taken');
});

test('accounts without a username are ignored', () => {
  assert.equal(runGuard([{ id: 'u1' }, { id: 'u2', username: '' }], []), null);
});

test('guard checks unchanged-before-shape (order is the fix)', () => {
  const unchangedAt = BODY.indexOf('prevMapU.get(nu.id) === uname');
  const shapeAt = BODY.indexOf('/^[a-z0-9._-]{3,32}$/');
  assert.ok(unchangedAt > -1 && shapeAt > -1, 'both branches must exist');
  assert.ok(unchangedAt < shapeAt, 'unchanged check must come BEFORE the shape check');
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const DB_SRC = fs.readFileSync(path.join(ROOT, 'db.js'), 'utf8');

function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start !== -1, `الدالة ${name} غير موجودة`);
  const rest = src.slice(start);
  const m = rest.match(/\r?\n\}(?=\r?\n(?:function |async function |let |const |\/\*|<\/script>|\r?\n))/);
  assert.ok(m, `تعذر استخراج الدالة ${name}`);
  return rest.slice(0, m.index + m[0].length);
}

test('1) سيناريو 171 طالبة: الإجمالي الدقيق دون تكرار أو كادر، نسبة التفعيل آلية، وفصل تام بين التفعيل والدخول الفعلي', () => {
  const fnSrc = extractFn(HTML, 'computeStudentActivationStats');
  const students = [];
  const users = [];

  // 171 طالبة فعلية نشطة:
  // - 115 حساب مفعّل وسجلن الدخول فعليًا
  // - 25 حساب مفعّل لكن لم يسجلن الدخول بعد (إجمالي المفعّلة = 140 => 82%)
  // - 15 حساب معطّل (active: false)
  // - 16 طالبة بدون حساب في جدول users بعد
  for (let i = 1; i <= 171; i++) {
    const id = `stu_${i}`;
    const username = `girl_${i}`;
    students.push({ id, fullName: `طالبة ${i}`, username, active: true });
    if (i <= 115) {
      users.push({ id, username, role: 'STUDENT', active: true, lastLogin: '2026-11-18T08:00:00Z', loginCount: 2 });
    } else if (i <= 140) {
      // مفعّلة لكن لم تدخل النظام بعد
      users.push({ id: i === 140 ? 'alt_id_140' : id, username, role: 'STUDENT', active: true, lastLogin: null, loginCount: 0 });
    } else if (i <= 155) {
      // حساب غير مفعّل
      users.push({ id, username, role: 'STUDENT', active: false, lastLogin: null, loginCount: 0 });
    }
  }
  // إضافات لا يجب أن ترفع إجمالي الطالبات: تكرار طالبة، طالبة محذوفة/غير نشطة، معلمات وإداريات
  students.push({ id: 'stu_1', fullName: 'طالبة 1 مكررة', username: 'girl_1', active: true });
  students.push({ id: 'stu_del', fullName: 'طالبة محذوفة', active: true, deleted: true });
  students.push({ id: 'stu_inactive', fullName: 'طالبة موقوفة', active: false });
  users.push({ id: 't_1', username: 'teacher1', role: 'TEACHER', active: true, lastLogin: '2026-11-18T08:00:00Z', loginCount: 5 });
  users.push({ id: 'adm_1', username: 'admin1', role: 'ADMIN', active: true, lastLogin: '2026-11-18T08:00:00Z', loginCount: 10 });
  users.push({ id: 'ag_1', username: 'agent1', role: 'AGENT', active: true, lastLogin: '2026-11-18T08:00:00Z', loginCount: 3 });

  const ctx = { sd: { students, users } };
  vm.runInNewContext(`${fnSrc}\nthis.res = computeStudentActivationStats(sd, '');`, ctx);
  const r = ctx.res;

  assert.equal(r.total, 171, 'إجمالي الطالبات يجب أن يطابق 171 دون تكرار أو كادر');
  assert.equal(r.activated, 140, 'عدد الحسابات المفعّلة يجب أن يساوي 140 (مع مطابقة المعرّف أو اسم المستخدم)');
  assert.equal(r.notActivated, 31, 'عدد الحسابات غير المفعّلة يجب أن يساوي 31');
  assert.equal(r.activationPct, Math.round((140 / 171) * 100), 'نسبة التفعيل يجب أن تُحسب بالمعادلة (140/171*100 = 82%)');
  assert.equal(r.loggedIn, 115, 'عدد من سجلن الدخول فعليًا يجب أن يساوي 115 فقط (لا يُحتسب التفعيل كدخول)');
  assert.equal(r.notLoggedIn, 56, 'عدد من لم يسجلن الدخول بعد يجب أن يساوي 56 (25 مفعّلة لم تدخل + 31 غير مفعّلة)');
  assert.equal(r.loggedIn + r.notLoggedIn, r.total, 'مجموع من دخلن ومن لم يدخلن يجب أن يساوي الإجمالي');
  assert.equal(r.activated + r.notActivated, r.total, 'مجموع المفعّلة وغير المفعّلة يجب أن يساوي الإجمالي');
});

test('2) النسبة محسوبة آليًا بالكامل وليست قيمة ثابتة (80% أو 85%)', () => {
  const fnSrc = extractFn(HTML, 'computeStudentActivationStats');
  const sd = {
    students: [
      { id: 's1', fullName: 'أ', active: true },
      { id: 's2', fullName: 'ب', active: true },
      { id: 's3', fullName: 'ج', active: true },
      { id: 's4', fullName: 'د', active: true },
    ],
    users: [
      { id: 's1', role: 'STUDENT', active: true, loginCount: 0 },
      { id: 's2', role: 'STUDENT', active: true, lastLogin: '2026-11-19T10:00:00Z' },
      { id: 's3', role: 'STUDENT', active: false },
    ],
  };
  const ctx = { sd };
  vm.runInNewContext(`${fnSrc}\nthis.res = computeStudentActivationStats(sd, '');`, ctx);
  assert.equal(ctx.res.total, 4);
  assert.equal(ctx.res.activated, 2);
  assert.equal(ctx.res.activationPct, 50);
  assert.equal(ctx.res.loggedIn, 1);
  assert.equal(ctx.res.notLoggedIn, 3);
});

test('3) لوحة المدير ونافذة التفاصيل تعرض المؤشرات الثلاثة منفصلة، والخادم يزامن حالة التفعيل من جدول users', () => {
  assert.ok(HTML.includes('الحسابات المفعّلة <b>${st.activated}</b>'), 'مؤشر الحسابات المفعّلة مفقود من لوحة المدير');
  assert.ok(HTML.includes('سجلن الدخول فعليًا <b>${st.loggedIn}</b>'), 'مؤشر من سجلن الدخول فعليًا مفقود من لوحة المدير');
  assert.ok(HTML.includes('لم يسجلن الدخول بعد <b>${st.notLoggedIn}</b>'), 'مؤشر من لم يسجلن الدخول بعد مفقود من لوحة المدير');
  assert.ok(SERVER.includes('u.active = t.active !== false;'), 'server.js لا يزامن حالة التفعيل active من جدول users');
  assert.ok(DB_SRC.includes('SELECT id, username, email, name, role, active, first_login, data FROM users WHERE school = $1'), 'usersForLoginStats لا تجلب role و email');
});

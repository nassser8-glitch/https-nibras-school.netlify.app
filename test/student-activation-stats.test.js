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

test('1) سيناريو 171 طالبة: 138 مفعّلة (سجلن الدخول مرة على الأقل = 80.70%) و33 غير مفعّلة (لم يسجلن مطلقًا = 19.30%)', () => {
  const fnSrc = extractFn(HTML, 'computeStudentActivationStats');
  const students = [];
  const users = [];

  // 171 طالبة فعلية نشطة:
  // - 138 طالبة سجلن الدخول مرة واحدة على الأقل (بعضهن دخلن 10 مرات، وبعضهن دخلن قديمًا مرة واحدة فقط، وإحداهن active:false لكنها دخلت سابقًا)
  // - 33 طالبة لم يسجلن الدخول مطلقًا (معظمهن active:true تقنيًا، وبعضهن بلا حساب، فلا يُحتسبن مفعّلات!)
  for (let i = 1; i <= 171; i++) {
    const id = `stu_${i}`;
    const username = `girl_${i}`;
    students.push({ id, fullName: `طالبة ${i}`, username, active: true });
    if (i <= 100) {
      users.push({ id, username, role: 'STUDENT', active: true, lastLogin: '2026-11-18T08:00:00Z', loginCount: 10 });
    } else if (i <= 137) {
      // دخلت مرة واحدة قديمًا
      users.push({ id, username, role: 'STUDENT', active: true, lastLogin: '2026-09-02T07:30:00Z', loginCount: 1 });
    } else if (i === 138) {
      // مطابقة باسم المستخدم مع سجل دخول سابق
      users.push({ id: 'alt_id_138', username, role: 'STUDENT', active: true, loginHistory: ['2026-09-10T08:00:00Z'] });
    } else if (i <= 165) {
      // حساب active=true تقنيًا لكن لم تسجل الدخول مطلقًا => غير مفعّلة
      users.push({ id, username, role: 'STUDENT', active: true, lastLogin: null, loginCount: 0, loginHistory: [] });
    }
    // البقية (166..171): بلا سجل في users بعد => غير مفعّلات
  }
  // تكرار + محذوفة + غير نشطة + معلمة + إدارية (لا يجوز احتسابها ضمن 171)
  students.push({ id: 'stu_1', fullName: 'طالبة 1 مكررة', username: 'girl_1', active: true });
  students.push({ id: 'stu_del', fullName: 'طالبة محذوفة', active: true, deleted: true });
  students.push({ id: 'stu_inactive', fullName: 'طالبة موقوفة', active: false });
  users.push({ id: 't_1', username: 'teacher1', role: 'TEACHER', active: true, lastLogin: '2026-11-18T08:00:00Z', loginCount: 5 });
  users.push({ id: 'adm_1', username: 'admin1', role: 'ADMIN', active: true, lastLogin: '2026-11-18T08:00:00Z', loginCount: 10 });

  const ctx = { sd: { students, users } };
  vm.runInNewContext(`${fnSrc}\nthis.res = computeStudentActivationStats(sd, '');`, ctx);
  const r = ctx.res;

  assert.equal(r.total, 171, 'إجمالي الطالبات يجب أن يساوي 171');
  assert.equal(r.activated, 138, 'الحسابات المفعّلة (سبق لهن الدخول مرة على الأقل) يجب أن تساوي 138 (دون جمع عدد مرات الدخول)');
  assert.equal(r.notActivated, 33, 'الحسابات غير المفعّلة (لم يسجلن مطلقًا) يجب أن تساوي 33 حتى لو كان active=true');
  assert.equal(r.activationPctText, '80.70', 'نسبة التفعيل يجب أن تساوي 80.70%');
  assert.equal(r.notActivatedPctText, '19.30', 'نسبة عدم التفعيل يجب أن تساوي 19.30%');
  assert.equal(r.activeAccounts, 165, 'الحالة التقنية للحساب (active=true) تبقى مفصولة عن التفعيل الفعلي');
  assert.equal(r.activated + r.notActivated, r.total);
});

test('2) الحساب ديناميكي بالكامل ولا يعتبر active=true تفعيلًا أبدًا', () => {
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
      { id: 's2', role: 'STUDENT', active: true, lastLogin: '2026-11-19T10:00:00Z', loginCount: 5 },
      { id: 's3', role: 'STUDENT', active: true },
      { id: 's4', role: 'STUDENT', active: false },
    ],
  };
  const ctx = { sd };
  vm.runInNewContext(`${fnSrc}\nthis.res = computeStudentActivationStats(sd, '');`, ctx);
  assert.equal(ctx.res.total, 4);
  assert.equal(ctx.res.activated, 1, 'طالبة واحدة فقط سجلت الدخول (active=true لا يعني التفعيل)');
  assert.equal(ctx.res.notActivated, 3);
  assert.equal(ctx.res.activationPctText, '25.00');
  assert.equal(ctx.res.notActivatedPctText, '75.00');
});

test('3) لوحة المدير تعرض الحسابات المفعّلة وغير المفعّلة بالنسب المختصرة دون سطر إجمالي الطالبات الزائد', () => {
  assert.ok(!HTML.includes('إجمالي الطالبات <b>${st.total}</b>'), 'يجب إزالة سطر إجمالي الطالبات أسفل الإحصائية');
  assert.ok(HTML.includes('الحسابات المفعّلة <b>${st.activated}</b> <span class="muted small">(${pctText}%)</span>'), 'عبارة الحسابات المفعّلة المختصرة مفقودة');
  assert.ok(HTML.includes('الحسابات غير المفعّلة <b>${notActivated}</b> <span class="muted small">(${notPctText}%)</span>'), 'عبارة الحسابات غير المفعّلة المختصرة مفقودة');
  assert.ok(SERVER.includes('studentUnameSet'), 'server.js لا تطابق الطالبات باسم المستخدم عند الإسقاط من جدول users');
  assert.ok(DB_SRC.includes('SELECT id, username, email, name, role, active, first_login, data FROM users WHERE school = $1'), 'usersForLoginStats لا تجلب الحقول الكاملة');
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const DB = fs.readFileSync(path.join(ROOT, 'db.js'), 'utf8');

test('نموذج إضافة الطالبة يحتوي الحقول المطلوبة ولا يعرض اختيار الفصل أو تأكيد كلمة المرور', () => {
  const start = HTML.indexOf('<div id="studentForm"');
  const end = HTML.indexOf('<div id="studentCredsModal"', start);
  assert.ok(start >= 0 && end > start, 'student form block exists');
  const form = HTML.slice(start, end);
  for (const id of ['sFullName','sStudentNo','sGradeId','sGuardianPhone','sEmail','sUsername','sPassword']) assert.ok(form.includes('id="' + id + '"'), 'missing ' + id);
  assert.ok(!form.includes('id="sClassId"'), 'class picker should be removed');
  assert.ok(!/تأكيد كلمة المرور|confirmPassword/i.test(form), 'confirmation password field should not exist');
  assert.ok(form.includes('suggestStudentUsernameField'), 'username suggestion action should exist');
});

test('إنشاء الطالبة يرسل الصف والجوال والبريد الاختياري إلى API', () => {
  const start = HTML.indexOf('async function addStudent(){');
  const end = HTML.indexOf('\nasync function deleteStudent(', start);
  const fn = HTML.slice(start, end);
  assert.ok(fn.includes('gradeId, classId, username, password: inputPassword'));
  assert.ok(fn.includes('email: email || null'));
  assert.ok(fn.includes('guardianPhone'));
  assert.ok(fn.includes('defaultStudentClassForGrade'));
});

test('الخادم يقبل البريد الفارغ للطالبة ويرفض الصيغة غير الصحيحة', () => {
  const start = SERVER.indexOf("app.post('/api/auth/admin/create-student'");
  const end = SERVER.indexOf("app.post(", start + 10);
  const route = SERVER.slice(start, end);
  assert.ok(route.includes("const email = String(req.body && req.body.email || '').trim().toLowerCase() || null"));
  assert.ok(route.includes("if (email && !/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(email))"));
  assert.ok(route.includes('gradeId'));
  assert.ok(!route.includes("username + '@nibras.school'"), 'must not generate a fake email');
});

test('قاعدة البيانات تجعل البريد اختيارياً وتطبّق migration على الجداول الموجودة', () => {
  assert.ok(/email\s+TEXT,/.test(DB), 'new users.email column must be nullable');
  assert.ok(DB.includes('ALTER TABLE users ALTER COLUMN email DROP NOT NULL'));
  assert.ok(DB.includes("lower(username) = lower($1)"));
  assert.ok(DB.includes("u.email == null || !String(u.email).trim()"));
});

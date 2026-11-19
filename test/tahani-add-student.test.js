'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const bcrypt = require('bcryptjs');
const db = require('../db');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

function extractFn(src, name) {
  const token = 'function ' + name + '(';
  const idx = src.indexOf(token);
  if (idx < 0) throw new Error('fn not found: ' + name);
  let i = src.indexOf('{', idx);
  let depth = 0;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return src.slice(idx, i + 1);
    }
  }
  throw new Error('unbalanced fn: ' + name);
}

const TAHANI = {
  id: 'id_61e90132bc11ff7b',
  user_id: 'id_61e90132bc11ff7b',
  name: 'تهاني أحمد',
  username: 'tahani',
  email: 'tahani@nibras.school',
  role: 'ADMINISTRATIVE',
  school: 'GIRLS',
};

const OTHER_ADMIN_STAFF = {
  id: 'id_other_admin_staff',
  user_id: 'id_other_admin_staff',
  name: 'إدارية أخرى',
  username: 'other_admin',
  email: 'other@nibras.school',
  role: 'ADMINISTRATIVE',
  school: 'GIRLS',
};

function loadHelper(sourceText) {
  const managersMatch = sourceText.match(/const GIRLS_ADMIN_STUDENT_MANAGERS = \[[\s\S]*?\];/);
  const idsMatch = sourceText.match(/const GIRLS_ADMIN_STUDENT_MANAGER_IDS = \[[^\]]*\];/);
  const unamesMatch = sourceText.match(/const GIRLS_ADMIN_STUDENT_MANAGER_USERNAMES = \[[^\]]*\];/);
  const emailsMatch = sourceText.match(/const GIRLS_ADMIN_STUDENT_MANAGER_EMAILS = \[[^\]]*\];/);
  assert.ok(managersMatch && idsMatch && unamesMatch && emailsMatch, 'قوائم تهاني مفقودة');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(
    [
      managersMatch[0],
      idsMatch[0],
      unamesMatch[0],
      emailsMatch[0],
      extractFn(sourceText, 'isGirlsAdminStudentManager'),
      'globalThis.check = isGirlsAdminStudentManager;',
    ].join('\n'),
    ctx
  );
  return ctx.check;
}

test('1) isGirlsAdminStudentManager تطابق هوية تهاني أحمد الفعلية في الخادم والواجهة وترفض غيرها', () => {
  for (const [label, src] of [['server.js', SERVER], ['public/index.html', SRC]]) {
    const check = loadHelper(src);
    assert.equal(check(TAHANI), true, `${label}: كائن تهاني الكامل`);
    assert.equal(check({ user_id: TAHANI.id, role: 'ADMINISTRATIVE', school: 'GIRLS' }), true, `${label}: جلسة الخادم`);
    assert.equal(check({ id: TAHANI.id, name: 'تهاني أحمد', username: 'tahani', email: 'tahani@nibras.school', role: 'ADMINISTRATIVE', school: 'GIRLS', active: true }), true, `${label}: كائن sendUser بعد تسجيل الدخول`);

    assert.equal(check(OTHER_ADMIN_STAFF), false, `${label}: إدارية أخرى تُرفض`);
    assert.equal(check({ ...TAHANI, school: 'BOYS' }), false, `${label}: قسم البنين يُرفض`);
    assert.equal(check({ id: TAHANI.id, username: 'tahani', role: 'ADMINISTRATIVE' }), false, `${label}: بدون school يُرفض`);
    assert.equal(check({ id: TAHANI.id, username: 'wrong', role: 'ADMINISTRATIVE', school: 'GIRLS' }), false, `${label}: تعارض username`);
    assert.equal(check({ id: TAHANI.id, email: 'wrong@nibras.school', role: 'ADMINISTRATIVE', school: 'GIRLS' }), false, `${label}: تعارض email`);
    for (const role of ['ADMIN', 'AGENT', 'COUNSELOR', 'TEACHER', 'SCHOOL_AGENT', 'STUDENT']) {
      assert.equal(check({ ...TAHANI, role }), false, `${label}: الدور ${role} يُرفض`);
    }
  }
});

test('2) الخادم: السماح لتهاني بمسار create-student فقط مع بقاء create-user و delete-students و settings محمية', () => {
  const createStuIdx = SERVER.indexOf("app.post('/api/auth/admin/create-student'");
  const createStuBlock = SERVER.slice(createStuIdx, createStuIdx + 700);
  assert.ok(createStuBlock.includes('!canManageUsers(req.session, school) && !isGirlsAdminStudentManager(req.session)'));
  assert.ok(createStuBlock.includes('const actor = await db.userById(req.session.user_id);'));
  assert.ok(createStuBlock.includes('if (!isGirlsAdminStudentManager(actor)) return res.status(403)'));

  const createUserIdx = SERVER.indexOf("app.post('/api/auth/admin/create-user'");
  const createUserBlock = SERVER.slice(createUserIdx, createUserIdx + 400);
  assert.ok(!createUserBlock.includes('isGirlsAdminStudentManager'), 'create-user يجب أن يبقى مقصوراً على canManageUsers');

  const delAllIdx = SERVER.indexOf("app.post('/api/auth/admin/delete-students'");
  const delAllBlock = SERVER.slice(delAllIdx, delAllIdx + 400);
  assert.ok(delAllBlock.includes("if (req.session.role !== 'ADMIN') return res.status(403)"));
  assert.ok(!delAllBlock.includes('isGirlsAdminStudentManager'));

  const putSettingsIdx = SERVER.indexOf("app.put('/api/settings/:school'");
  const putSettingsBlock = SERVER.slice(putSettingsIdx, putSettingsIdx + 450);
  assert.ok(putSettingsBlock.includes("if (req.session.role !== 'ADMIN' && req.session.role !== 'COUNSELOR') return res.status(403)"));
});

test('3) الواجهة: زر إضافة طالبة ونموذج الإضافة متاحان لتهاني، وحذف الكل يبقى للمدير فقط', () => {
  const renderBody = extractFn(SRC, 'renderStudents');
  assert.ok(renderBody.includes('isGirlsAdminStudentManager(user)'));
  assert.ok(renderBody.includes("toggleEl('studentForm')"));
  const delAllLine = renderBody.split('\n').find(l => l.includes('deleteAllStudents()'));
  assert.ok(delAllLine && delAllLine.includes('${isAdmin ?'), 'زر حذف الكل للمدير فقط');

  const addBody = extractFn(SRC, 'addStudent');
  assert.ok(addBody.includes('isGirlsAdminStudentManager(u)'));
});

test('4) اختبار إضافة طالبة تجريبيًا في الذاكرة (دون لمس قاعدة الإنتاج) مع رفض الحسابات غير المصرح لها', async () => {
  const checkServer = loadHelper(SERVER);
  const canManage = (u, s) => u.role === 'ADMIN' || (u.role === 'AGENT' && u.school === s);
  const isAuthorized = (session, dbActor) => {
    if (canManage(session, 'GIRLS')) return true;
    return checkServer(session) && checkServer(dbActor);
  };

  assert.equal(isAuthorized({ user_id: TAHANI.id, role: 'ADMINISTRATIVE', school: 'GIRLS' }, TAHANI), true);
  assert.equal(isAuthorized({ user_id: OTHER_ADMIN_STAFF.id, role: 'ADMINISTRATIVE', school: 'GIRLS' }, OTHER_ADMIN_STAFF), false);
  assert.equal(isAuthorized({ user_id: 't1', role: 'TEACHER', school: 'GIRLS' }, { id: 't1', role: 'TEACHER', school: 'GIRLS' }), false);

  // محاكاة إنشاء طالبة كاملة عبر db.createStudentAccountAndRecord بـ pool وهمي في الذاكرة فقط
  const state = {
    users: [{ id: TAHANI.id, school: 'GIRLS', name: TAHANI.name, email: TAHANI.email, username: TAHANI.username, role: 'ADMINISTRATIVE', active: true }],
    schoolData: {
      users: [],
      grades: [{ id: 'g1', name: 'الأول الابتدائي', order: 0 }],
      classes: [{ id: 'g1_a', gradeId: 'g1', name: 'أ' }],
      students: [],
    },
  };
  const origConnect = db.pool.connect;
  db.pool.connect = async () => ({
    async query(sql, params) {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.startsWith('SELECT 1 FROM users WHERE id')) return { rows: state.users.some(u => u.id === params[0]) ? [{}] : [] };
      if (sql.startsWith('SELECT 1 FROM users WHERE lower(username)')) return { rows: state.users.some(u => String(u.username).toLowerCase() === String(params[0]).toLowerCase()) ? [{}] : [] };
      if (sql.startsWith('INSERT INTO school_data')) return { rows: [] };
      if (sql.startsWith('SELECT data FROM school_data')) return { rows: [{ data: state.schoolData }] };
      if (sql.startsWith('INSERT INTO users')) {
        state.users.push({ id: params[0], school: params[1], name: params[2], email: params[3], username: params[4], role: 'STUDENT', active: true });
        return { rows: [] };
      }
      if (sql.startsWith('UPDATE school_data')) { state.schoolData = JSON.parse(params[1]); return { rows: [] }; }
      throw new Error('unexpected query: ' + sql);
    },
    release() {},
  });
  try {
    const hash = await bcrypt.hash('TestPass1', 4);
    const res = await db.createStudentAccountAndRecord({
      id: 'stu_test_tahani',
      school: 'GIRLS',
      name: 'لينا فهد العتيبي',
      username: 'lina.fahad',
      email: null,
      password: 'TestPass1',
      passwordHash: hash,
      student: { fullName: 'لينا فهد العتيبي', studentNo: '9901', gradeId: 'g1', classId: 'g1_a', guardianPhone: '966550000001', active: true, joinedAt: Date.now() },
    });
    assert.equal(res.id, 'stu_test_tahani');
    assert.equal(res.grade, 'الأول الابتدائي');
    assert.equal(res.class, 'أ');
    assert.equal(state.schoolData.students.length, 1);
  } finally {
    db.pool.connect = origConnect;
  }
});

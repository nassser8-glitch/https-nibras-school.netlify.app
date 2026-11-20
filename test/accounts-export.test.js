'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

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

const EXPECTED_COLS = [
  'الاسم الكامل',
  'اسم المستخدم',
  'الدور / الصفة',
  'الصف الدراسي',
  'الفصل',
  'حالة الحساب',
];

function loadExportHarness(school, role, db) {
  const alerts = [];
  const written = [];
  const ctx = {
    currentUser: () => (role ? { id: 'u_actor', role, school } : null),
    getActiveSchool: () => school,
    loadDB: () => db,
    roleLabel: (r) => ({ ADMIN: 'مدير', AGENT: 'وكيلة', TEACHER: 'معلمة', COUNSELOR: 'موجهة طلابية', ADMINISTRATIVE: 'إدارية', SCHOOL_AGENT: 'وكيلة الشؤون المدرسية' }[r] || r),
    alert: (m) => { alerts.push(m); },
    XLSX: {
      utils: {
        json_to_sheet: (rows) => ({ __rows: rows }),
        book_new: () => ({ sheets: {} }),
        book_append_sheet: (wb, ws, name) => { wb.sheets[name] = ws; },
      },
      writeFile: (wb, fileName) => { written.push({ wb, fileName }); },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(
    [
      extractFn(HTML, 'buildAccountsExportRows'),
      extractFn(HTML, 'exportAccountsExcel'),
      'globalThis.buildAccountsExportRows = buildAccountsExportRows;',
      'globalThis.exportAccountsExcel = exportAccountsExcel;',
    ].join('\n'),
    ctx
  );
  return { ctx, alerts, written };
}

test('1) المدير فقط يستطيع التصدير، وملف Excel يحتوي الأعمدة الستة المطلوبة فقط بلا أي كلمة مرور أو بيانات سرية', () => {
  const db = {
    grades: [{ id: 'g1', name: 'الأول الابتدائي' }],
    classes: [{ id: 'c1', gradeId: 'g1', name: 'أ' }],
    students: [{ id: 's1', fullName: 'سارة علي', classId: 'c1', gradeId: 'g1', active: true }],
    users: [
      { id: 'u_adm', school: 'GIRLS', name: 'ناصر العتيبي', username: 'admin', role: 'ADMIN', active: true, password: 'SECRET_PASSWORD_1', plain_password: 'SECRET_PASSWORD_2', password_hash: '$2b$10$SECRET_HASH' },
      { id: 'u_t', school: 'GIRLS', name: 'سلوى هدايت', username: 'salwa2', role: 'TEACHER', active: false, plain_password: 'SECRET_PASSWORD_3' },
      { id: 's1', school: 'GIRLS', name: 'سارة علي', username: 'sara.ali', role: 'STUDENT', active: true, plain_password: 'a1111111' },
      { id: 'u_boys', school: 'BOYS', name: 'طالب بنين', username: 'boy1', role: 'STUDENT', active: true },
      { id: 'u_del', school: 'GIRLS', name: 'محذوف', username: 'del1', role: 'TEACHER', active: false, deleted: true },
    ],
  };
  const beforeSnap = JSON.stringify(db);

  const { ctx, written, alerts } = loadExportHarness('GIRLS', 'ADMIN', db);
  ctx.exportAccountsExcel();

  assert.equal(alerts.length, 0);
  assert.equal(written.length, 1);
  assert.equal(written[0].fileName, 'حسابات_قسم_البنات.xlsx');
  const rows = written[0].wb.sheets['حسابات البنات'].__rows;
  assert.equal(rows.length, 3, 'يستبعد حسابات البنين والمحذوفين');

  for (const r of rows) {
    assert.deepEqual(Object.keys(r), EXPECTED_COLS, 'الأعمدة الستة فقط بدون أي عمود إضافي');
  }
  const serialized = JSON.stringify(rows);
  assert.ok(!/SECRET_PASSWORD|SECRET_HASH|a1111111|password|plain_password|كلمة المرور/i.test(serialized), 'لا توجد أي كلمة مرور أو قيمة سرية في الملف الناتج');

  const stuRow = rows.find(r => r['اسم المستخدم'] === 'sara.ali');
  assert.equal(stuRow['الدور / الصفة'], 'طالبة');
  assert.equal(stuRow['الصف الدراسي'], 'الأول الابتدائي');
  assert.equal(stuRow['الفصل'], 'أ');
  assert.equal(stuRow['حالة الحساب'], 'مفعّل');

  const inactiveRow = rows.find(r => r['اسم المستخدم'] === 'salwa2');
  assert.equal(inactiveRow['حالة الحساب'], 'غير مفعّل');

  assert.equal(JSON.stringify(db), beforeSnap, 'التصدير قراءة فقط ولا يعدّل أي بيانات');
});

test('2) رفض التصدير لغير المدير (AGENT, TEACHER, COUNSELOR, ADMINISTRATIVE, SCHOOL_AGENT, STUDENT)', () => {
  const db = { users: [{ id: 'u1', school: 'GIRLS', name: 'سارة', username: 'sara', role: 'TEACHER', active: true }] };
  for (const role of ['AGENT', 'TEACHER', 'COUNSELOR', 'ADMINISTRATIVE', 'SCHOOL_AGENT', 'STUDENT', null]) {
    const { ctx, written, alerts } = loadExportHarness('GIRLS', role, db);
    ctx.exportAccountsExcel();
    assert.equal(written.length, 0, `${role} لا يمكنه تصدير الملف`);
    assert.equal(alerts.length, 1, `${role} يتلقى تنبيه رفض الصلاحية`);
  }
});

test('3) زر «📥 تصدير الحسابات» في الواجهة محصور بـ isAdmin فقط', () => {
  const matches = HTML.split(/\r?\n/).filter(l => l.includes('onclick="exportAccountsExcel()"'));
  assert.ok(matches.length >= 2, 'الزر موجود في واجهة الإدارة والطلاب');
  for (const line of matches) {
    assert.ok(line.includes('${isAdmin ?'), 'كل زر تصدير يجب أن يكون محصورًا بـ isAdmin');
  }
});

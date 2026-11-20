'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start !== -1, `الدالة ${name} غير موجودة`);
  const rest = src.slice(start);
  const m = rest.match(/\r?\n\}(?=\r?\n(?:function |let |const |\/\*|<\/script>|\r?\n))/);
  assert.ok(m, `تعذر استخراج الدالة ${name}`);
  return rest.slice(0, m.index + m[0].length);
}

test('1) قسم الأوائل في صفحة الطلبة يقتصر على أفضل 5 طالبات فقط (slice(0,5))', () => {
  const fnSrc = extractFn(HTML, 'renderStudentLeaders');
  assert.ok(fnSrc.includes('withPts.slice(0,5)'), 'renderStudentLeaders لا تستخدم withPts.slice(0,5)');
  assert.ok(!fnSrc.includes('withPts.slice(0,20)'), 'لا يزال يوجد slice(0,20) في renderStudentLeaders');
});

test('2) عرض أفضل 5 طالبات فقط مرتبات من الأولى إلى الخامسة دون إظهار بقية الفصل ودون تعديل بيانات الطالبات', () => {
  const fnSrc = extractFn(HTML, 'renderStudentLeaders');
  const students = Array.from({ length: 10 }, (_, idx) => ({
    id: `s${idx + 1}`,
    fullName: `طالبة رقم ${idx + 1}`,
    classId: 'c1',
    active: true,
  }));
  const ptsMap = {
    s1: 5, s2: 95, s3: 40, s4: 80, s5: 70,
    s6: 60, s7: 50, s8: 30, s9: 20, s10: 10,
  };
  const db = {
    grades: [{ id: 'g1', name: 'الأول المتوسط', order: 6 }],
    classes: [{ id: 'c1', gradeId: 'g1', name: 'أ' }],
    students,
  };
  const sandbox = {
    loadDB: () => db,
    currentUser: () => ({ id: 's1', role: 'STUDENT' }),
    studentPointsMap: () => ptsMap,
    renderNibrasPioneers: () => '<div>pioneers</div>',
    escapeHtml: (s) => String(s == null ? '' : s),
  };
  vm.createContext(sandbox);
  const html = vm.runInContext(`${fnSrc}\nrenderStudentLeaders();`, sandbox);

  const tbodies = [...html.matchAll(/<tbody>([\s\S]*?)<\/tbody>/g)].map(m => m[1]);
  assert.equal(tbodies.length, 2, 'المتوقع جدولان فقط في بيانات الاختبار (فصلي + المتوسط)');

  for (const tbody of tbodies) {
    const rows = [...tbody.matchAll(/<tr[\s\S]*?<\/tr>/g)].map(m => m[0]);
    assert.equal(rows.length, 5, 'يجب عرض 5 طالبات فقط في قائمة الأوائل');
    assert.ok(rows[0].includes('🥇') && rows[0].includes('طالبة رقم 2') && rows[0].includes('+95'), 'الأولى غير صحيحة');
    assert.ok(rows[1].includes('🥈') && rows[1].includes('طالبة رقم 4') && rows[1].includes('+80'), 'الثانية غير صحيحة');
    assert.ok(rows[2].includes('🥉') && rows[2].includes('طالبة رقم 5') && rows[2].includes('+70'), 'الثالثة غير صحيحة');
    assert.ok(rows[3].includes('>4<') && rows[3].includes('طالبة رقم 6') && rows[3].includes('+60'), 'الرابعة غير صحيحة');
    assert.ok(rows[4].includes('>5<') && rows[4].includes('طالبة رقم 7') && rows[4].includes('+50'), 'الخامسة غير صحيحة');
    // التأكد من عدم ظهور بقية طالبات الفصل (السادسة إلى العاشرة)
    for (const excluded of ['طالبة رقم 3', 'طالبة رقم 8', 'طالبة رقم 9', 'طالبة رقم 10', 'طالبة رقم 1<']) {
      assert.ok(!tbody.includes(excluded), `ظهرت طالبة خارج الخمس الأوائل: ${excluded}`);
    }
  }
  // التأكد من بقاء جميع الطالبات العشر دون حذف في القائمة الأساسية
  assert.equal(db.students.length, 10, 'لا يجب حذف أو تعديل بيانات الطالبات في قاعدة البيانات');
});

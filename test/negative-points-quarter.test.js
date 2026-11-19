'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const NP = require(path.join(ROOT, 'notes-privacy.js'));
const CLIENT = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

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

function loadClientPoints() {
  const trMap = CLIENT.match(/const transferDeductionMap = \{[\s\S]*?\};/);
  const nMap = CLIENT.match(/const notePointsMap = \{[\s\S]*?\};/);
  const undone = CLIENT.match(/const UNDONE_DEDUCTION = [^;]+;/);
  assert.ok(trMap && nMap && undone, 'خرائط النقاط في الواجهة مفقودة');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(
    [
      trMap[0],
      nMap[0],
      undone[0],
      extractFn(CLIENT, 'notePoints'),
      extractFn(CLIENT, 'attendancePoints'),
      'globalThis.out = { transferDeductionMap, notePointsMap, UNDONE_DEDUCTION, notePoints, attendancePoints };',
    ].join('\n'),
    ctx
  );
  return ctx.out;
}

const EXPECTED_POSITIVE = {
  'الانضباط': 5,
  'الاحترام': 5,
  'التعاون': 4,
  'المشاركة': 3,
  'المثابرة': 4,
  'تفوق دراسي': 10,
  'إنجاز الواجبات': 3,
  'القيادة': 6,
};

const EXPECTED_NEGATIVE = {
  'الغياب': -0.5,
  'التأخر': -0.25,
  'عدم إنجاز الواجبات': -1,
  'الإزعاج داخل الفصل': -1.25,
  'عدم الانضباط': -1.5,
  'قلة الاحترام': -1.75,
  'التنمر': -2.5,
  'عدم المشاركة': -0.75,
};

const EXPECTED_TRANSFER_DEDUCTIONS = {
  'الغياب المتكرر': -1,
  'التأخر المستمر': -0.5,
  'سلوك غير لائق': -1.25,
  'عدم إنجاز الواجبات': -1,
  'نزاع مع زملاء': -1.25,
  'مشكلة أسرية': 0,
  'صعوبات في التعلم': 0,
  'حاجة لمتابعة إرشادية': -0.25,
  'قلة انتباه أثناء الشرح': -0.5,
  'تعطيل سير الحصة': -1,
  'الأكل': -0.5,
  'أخرى': -0.75,
  'تحرير': -0.75,
};

test('1) النقاط الإيجابية لم تتغير إطلاقًا في الخادم والواجهة', () => {
  const client = loadClientPoints();
  for (const [cat, val] of Object.entries(EXPECTED_POSITIVE)) {
    assert.equal(NP.NOTE_POINTS_MAP[cat], val, `خادم: ${cat}`);
    assert.equal(client.notePointsMap[cat], val, `واجهة: ${cat}`);
    assert.equal(client.notePoints('POSITIVE', cat), val, `دالة الواجهة: ${cat}`);
  }
  assert.equal(client.notePoints('POSITIVE', 'أخرى'), 2, 'أخرى إيجابية تبقى 2');
  assert.equal(client.notePoints('POSITIVE', 'تحرير'), 2, 'تحرير إيجابية تبقى 2');
});

test('2) جميع النقاط السلبية تساوي ربع قيمتها الأصلية بدقة وتطابق بين الخادم والواجهة', () => {
  const client = loadClientPoints();
  for (const [cat, val] of Object.entries(EXPECTED_NEGATIVE)) {
    assert.equal(NP.NOTE_POINTS_MAP[cat], val, `خادم: ${cat}`);
    assert.equal(client.notePointsMap[cat], val, `واجهة: ${cat}`);
    assert.equal(client.notePoints('NEGATIVE', cat), val, `دالة الواجهة: ${cat}`);
  }
  assert.equal(client.notePoints('NEGATIVE', 'أخرى'), -0.75);
  assert.equal(client.notePoints('NEGATIVE', 'تحرير'), -0.75);
  assert.equal(client.UNDONE_DEDUCTION, -1, 'عدم إنجاز الواجب -4 → -1');

  // خصومات الحضور (الغياب والتأخر)
  assert.equal(client.attendancePoints('ABSENT', 0), -0.5);
  assert.equal(client.attendancePoints('LATE', 10), -0.25);
  assert.equal(client.attendancePoints('LATE', 25), -0.5);
  assert.equal(client.attendancePoints('LATE', 45), -0.75);
  assert.equal(client.attendancePoints('LATE', 75), -1);
  assert.equal(client.attendancePoints('PRESENT', 0), 0);

  // خصومات التحويلات
  for (const [reason, val] of Object.entries(EXPECTED_TRANSFER_DEDUCTIONS)) {
    assert.equal(client.transferDeductionMap[reason], val, `تحويل: ${reason}`);
  }
  assert.ok(CLIENT.includes('transferDeductionMap[reason] != null ? transferDeductionMap[reason] : -0.75'));
});

test('3) الجمع بين الإيجابية والسلبية والحفظ/الاسترجاع عبر JSON دون فقدان الكسور أو تكرار القسمة', () => {
  const STU = 'stu_1';
  const rawData = {
    students: [{ id: STU, active: true, classId: 'c1', joinedAt: '' }],
    notes: [
      { id: 'n1', studentId: STU, type: 'POSITIVE', category: 'الانضباط', points: 5, createdAt: '2026-10-01T08:00:00.000Z' },
      { id: 'n2', studentId: STU, type: 'NEGATIVE', category: 'الإزعاج داخل الفصل', points: -1.25, createdAt: '2026-10-02T08:00:00.000Z' },
      { id: 'n3', studentId: STU, type: 'NEGATIVE', category: 'أخرى', createdAt: '2026-10-03T08:00:00.000Z' }, // -0.75 عبر الخريطة
    ],
    attendance: [
      { studentId: STU, date: '2026-10-04', status: 'ABSENT' },               // -0.5
      { studentId: STU, date: '2026-10-05', status: 'LATE', lateMinutes: 10 }, // -0.25
      { studentId: STU, date: '2026-10-06', status: 'LATE', lateMinutes: 25 }, // -0.5
    ],
    assignments: [
      { id: 'a1', classId: 'c1', date: '2026-10-07', created: '2026-10-01T00:00:00.000Z', title: 'واجب 1', completedBy: [] }, // -1
    ],
  };

  // المجموع المتوقع: +5 + (-1.25 - 0.75 - 0.5 - 0.25 - 0.5 - 1) = +5 - 4.25 = 0.75
  const first = NP.computePointsTotals(rawData, '2026-09-07')[STU];
  assert.equal(first.pos, 5);
  assert.equal(first.neg, -4.25);
  assert.equal(first.total, 0.75);

  // محاكاة الحفظ والاسترجاع عبر JSONB وإعادة الحساب مرتين: لا تكرار للقسمة ولا فقدان للكسور
  const roundTripped = JSON.parse(JSON.stringify(rawData));
  const second = NP.computePointsTotals(roundTripped, '2026-09-07')[STU];
  const third = NP.computePointsTotals(JSON.parse(JSON.stringify(roundTripped)), '2026-09-07')[STU];
  assert.deepEqual(second, first);
  assert.deepEqual(third, first);
  assert.equal(String(second.total), '0.75');
  assert.equal(String(second.neg), '-4.25');
});

test('4) الرسوم البيانية والتقارير تستخدم parseFloat للحفاظ على الكسور مثل -0.5 و -0.25', () => {
  assert.ok(!CLIENT.includes("parseInt(r['النقاط'])"), 'يجب عدم استخدام parseInt على حقل النقاط');
  assert.ok(CLIENT.includes("parseFloat(r['النقاط'])"), 'يجب استخدام parseFloat على حقل النقاط');
});

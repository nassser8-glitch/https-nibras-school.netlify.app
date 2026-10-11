'use strict';
/* =============================================================================
 * غلاف localStorage.setItem: استخراج رمز القسم لجدولة الرفع
 * -----------------------------------------------------------------------------
 * عطل إنتاجي: كان النمط /^nibras_GIRLS_db_v1$/ بلا مجموعة التقاط، فـ m[1]
 * = undefined ⇒ __syncSchedule(undefined) ⇒ __syncPush(undefined) يقرأ مفتاحاً
 * وهمياً (nibras_undefined_db_v1) ويعود صامتاً. النتيجة: كل حفظ عبر saveDB
 * لا يُرفع للخادم، فيبقى تكليف المعلمة محلياً ويبدو «مختفياً» عند الإدارة.
 * الإصلاح: التقاط رمز القسم بين البادئة واللاحقة.
 * ========================================================================== */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

test('1) الغلاف يستخدم نمطاً بمجموعة التقاط (لا النمط القديم المعطوب)', () => {
  assert.ok(
    SRC.includes('const m = /^nibras_([A-Z]+)_db_v1$/.exec(k);'),
    'نمط التقاط رمز القسم مفقود من غلاف setItem'
  );
  assert.ok(
    !SRC.includes('const m = /^nibras_GIRLS_db_v1$/.exec(k);'),
    'النمط القديم المعطوب (بلا مجموعة التقاط) ما زال موجوداً'
  );
});

test('2) الغلاف يمرّر m[1] (رمز القسم) إلى __syncSchedule', () => {
  const i = SRC.indexOf('const m = /^nibras_([A-Z]+)_db_v1$/.exec(k);');
  const block = SRC.slice(i, i + 700);
  assert.ok(block.includes('__syncSchedule(m[1]);'), 'لا يمرّر رمز القسم المستخرج');
});

test('3) النمط الجديد يستخرج GIRLS، والقديم يعطي undefined', () => {
  const good = /^nibras_([A-Z]+)_db_v1$/.exec('nibras_GIRLS_db_v1');
  assert.strictEqual(good && good[1], 'GIRLS');
  const bad = /^nibras_GIRLS_db_v1$/.exec('nibras_GIRLS_db_v1');
  assert.strictEqual(bad[1], undefined, 'النمط القديم كان يعيد undefined (سبب العطل)');
});

test('4) __syncPush(undefined) لا يجد مفتاحاً — توثيق السبب', () => {
  // يثبت أن القيمة undefined تُنتج مفتاحاً وهمياً، وهو ما كان يجعل الرفع صامتاً.
  const key = 'nibras_' + undefined + '_db_v1';
  assert.strictEqual(key, 'nibras_undefined_db_v1');
});

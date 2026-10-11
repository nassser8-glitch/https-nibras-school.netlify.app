'use strict';
/* =============================================================================
 * حارس «لا يختفي حفظ المعلمة» — البقاء عبر الخروج وإعادة الفتح
 * -----------------------------------------------------------------------------
 * القصة: معلمات (شادية/سلوى هداية/سلوم) يكتبن تكليفاً فلا يصل الخادم، ثم
 * «يختفي» بعد إعادة فتح التطبيق/الدخول. السببان المرصودان:
 *   1) logout() كانت تمسح نسخة المدرسة من المتصفح كاملةً — فتُمحى بلا رجعة
 *      تعديلاتُ لم تُرفع (تكليف/نقطة/تحويل).
 *   2) __syncPull كان يستبدل النسخة المحلية بنسخة الخادم متى كانت «فارغة الهيكل»
 *      (classes/students = 0) — فيُدفن تكليفٌ محفوظ لم يُرفع بعد.
 *   3) رفض 403 كان يُسقط الدفعة بلا نسخة احتياطية (pendKey) وبلا سبب مسجّل.
 * يثبّت هذا الاختبار القواعد الجديدة في المصدر، وحضور مسار التشخيص على الخادم.
 * ========================================================================== */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const DB = fs.readFileSync(path.join(ROOT, 'db.js'), 'utf8');

function extractFn(name, src) {
  const start = src.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'لم أجد ' + name);
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('لم يُغلق جسم ' + name);
}

test('1) logout لا يمسح قاعدة المدرسة (تعديلات غير مرفوعة تنجو)', () => {
  const body = extractFn('logout', SRC);
  assert.ok(!body.includes('removeItem(dbKeyFor'),
    'logout يحذف قاعدة المدرسة — يمحو حفظاً لم يُرفع');
  assert.ok(body.includes("location.hash = '#/login'"), 'يظل يعيد التوجيه لشاشة الدخول');
});

test('2) السحب لا يستبدل نسخة محلية موجودة بنسخة الخادم (لا إسقاط للفارغ الهيكلي)', () => {
  assert.ok(!SRC.includes('if(!local || localIsEmptySeed)'),
    'ما زال يستبدل النسخة المحلية عند فراغ الهيكل');
  assert.ok(SRC.includes('if(!local){'),
    'الاستبدال مشروط بانعدام المحلية كلياً فقط');
  // الدمج يبقى الممرَّ الافتراضي: تكليفات/نشاطات/ملاحظات/تحويلات محلية تُحفظ
  assert.ok(SRC.includes('mergeByIdBetterP'), 'دمج التكليفات موجود');
});

test('3) رفض 403 يسجل السبب ويمر بممر الفشل (احتياطي معلّق لا يُسقط الحفظ)', () => {
  assert.ok(!SRC.includes('__authBlocked'), 'مسار 403 القديم (إسقاط بلا احتياطي) أُزيل');
  assert.ok(SRC.includes("lastErr = '403:' +"), 'سبب 403 يُسجَّل في السجل');
  assert.ok(SRC.includes("localStorage.setItem(pendKey, JSON.stringify(obj))"),
    'الاحتياطي المعلّق يُكتب عند الفشل');
});

test('4) الخادم: تدقيق الرفض + مسار قراءة المزامنة للمدير', () => {
  assert.ok(SERVER.includes("/api/diag/sync-audit"), 'مسار تشخيص المزامنة موجود');
  assert.ok(SERVER.includes("reason: 'reject:' +"), 'كل رد غير ناجح يُسجَّل بسببه');
  assert.ok(SERVER.includes('db.listSyncAudit('), 'يقرأ من قائمة التدقيق');
  assert.ok(DB.includes('async function listSyncAudit'), 'دالة القراءة معرّفة');
  assert.ok(/listSyncAudit,/.test(DB), 'مُصدَّرة من db.js');
  assert.ok(DB.includes("ADD COLUMN IF NOT EXISTS reason TEXT"), 'عمود السبب يُضاف ترقياً');
});

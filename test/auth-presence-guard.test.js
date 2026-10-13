'use strict';
/* =============================================================================
 * حارس صلاحيات الحضور وتدقيق المزامنة + منع تكرار الطلبات المرفوضة
 * -----------------------------------------------------------------------------
 * من أخطاء الإنتاج: GET /api/auth/presence?school=GIRLS → 401/403 متكرّرة،
 * و/api/diag/sync-audit → 403. القواعد المثبَّتة هنا:
 *   • حضور القراءة: ADMIN/AGENT فقط، وغيرهما 403 (لا نوسّع للمعلم/الطالبة).
 *   • تدقيق المزامنة: ADMIN فقط.
 *   • غير المسجَّل: 401 (المصادقة أولاً، لا 403).
 *   • الواجهة لم تعد تستخدم مسار الحضور: قسم «المتواجدون الآن» أُزيل نهائياً.
 * هذه اختبارات مصدر ثابتة (نمط بقية الاختبارات) بلا اتصال بقاعدة الإنتاج.
 * ========================================================================== */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const SRC = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

function routeBlock(src, needle) {
  const i = src.indexOf(needle);
  assert.ok(i >= 0, 'لم أجد المسار: ' + needle);
  return src.slice(i, i + 900);
}

test('1) غير المسجَّل: requireAuth يعيد 401 (المصادقة قبل الصلاحية)', () => {
  const body = routeBlock(SERVER, 'function requireAuth');
  assert.ok(body.includes("res.status(401).json({ error: 'unauthorized'"),
    'غير المسجَّل يجب أن يُردّ بـ401 لا 403');
});

test('2) GET حضور: ADMIN/AGENT فقط، وغيرهما 403 (بلا توسيع صلاحيات)', () => {
  const body = routeBlock(SERVER, "app.get('/api/auth/presence'");
  assert.ok(body.includes("req.session.role !== 'ADMIN' && req.session.role !== 'AGENT'"),
    'شرط الأدوار المصرّح لها مفقود');
  assert.ok(body.includes("res.status(403).json({ error: 'forbidden' })"),
    'غير المصرّح يجب أن يُردّ 403');
});

test('3) تدقيق المزامنة: ADMIN فقط', () => {
  const body = routeBlock(SERVER, "/api/diag/sync-audit");
  assert.ok(body.includes("req.session.role !== 'ADMIN'"),
    'يجب أن يبقى تدقيق المزامنة محصوراً بالمدير');
  assert.ok(body.includes("res.status(403).json({ error: 'forbidden' })"), '403 لغير المدير');
});

test('4) قسم «المتواجدون الآن» أُزيل من الواجهة (لم يبقَ أي استدعاء للحضور)', () => {
  assert.ok(!/renderPresentSection|updatePresentNow|refreshPresence|presentNowInfo/.test(SRC),
    'لم تبقَ أي دالة لقسم المتواجدات في الواجهة');
});

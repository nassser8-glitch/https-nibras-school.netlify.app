'use strict';
/* حماية بيانات التشخيص: مسارات /api/diag/* لم تعد مفتوحة للجمهور.
 *
 * الخلفية: teacher-dup و diag/db كانا يعرضان أسماء حساب المعلمات وقاعدة البيانات
 * بلا مصادقة؛ و diag/mail كان يرسل بريداً ويقوّس بادئة مفتاح Brevo؛ و diag/smtp
 * كان يتيح فحص منافذ بلا مصادقة. هذه الاختبارات تُثبّت النمط الجديد:
 *   requireAuth + if (req.session.role !== 'ADMIN') return 403
 * مع حارس الإرسال المقصود والحارس البيئي لفحص المنافذ، وتخفيض /api/health.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

const PROTECTED = ['/api/diag/teacher-dup', '/api/diag/db', '/api/diag/mail', '/api/diag/smtp'];

const SIDE_EFFECTS = {
  '/api/diag/teacher-dup': ['db.pool.query'],
  '/api/diag/db': ['db.pool.query'],
  '/api/diag/mail': ['sendResetEmail'],
  '/api/diag/smtp': ['tcpTest'],
};

function routeDecl(route, len) {
  const needle = "'" + route + "'";
  const i = SERVER.indexOf(needle);
  assert.ok(i >= 0, 'المسار موجود: ' + route);
  return SERVER.slice(i, i + (len || 500));
}

for (const route of PROTECTED) {
  test(route + ' يستعمل requireAuth كوسيط', () => {
    const i = SERVER.indexOf("'" + route + "'");
    assert.ok(i >= 0, 'المسار موجود: ' + route);
    const line = SERVER.slice(SERVER.lastIndexOf('\n', i), i + route.length + 40);
    assert.ok(/requireAuth\s*,/.test(line), 'requireAuth في قائمة الوسائط: ' + line.trim());
  });

  test(route + ' يرفض غير المدير بـ403 قبل أي أثر جانبي', () => {
    const decl = routeDecl(route, 600);
    assert.ok(
      /req\.session\.role\s*!==\s*'ADMIN'\)\s*return\s*res\.status\(403\)/.test(decl),
      'فحص دور ADMIN بـ403: ' + route
    );
    const guardIdx = decl.indexOf("req.session.role !== 'ADMIN'");
    const effects = SIDE_EFFECTS[route] || [];
    const firstEffect = Math.min(...effects.map((k) => decl.indexOf(k)).filter((x) => x >= 0));
    assert.ok(guardIdx >= 0, 'حارس الدور موجود');
    assert.ok(firstEffect === -1 || guardIdx < firstEffect,
      'حارس الدور قبل أول أثر جانبي (' + effects.join(', ') + ') لـ' + route);
  });
}

test('لم تبقَ أي /api/diag بلا requireAuth', () => {
  const unguarded = [];
  const re = /app\.(get|post|put|delete)\(\s*'(\/api\/diag[^']*)'/g;
  let m;
  while ((m = re.exec(SERVER)) !== null) {
    const tail = SERVER.slice(m.index, m.index + m[0].length + 100);
    if (!/requireAuth/.test(tail)) unguarded.push(m[2]);
  }
  assert.deepEqual(unguarded, [], 'كل مسارات /api/diag محمية');
});

test('diag/mail: لا كشف لمفاتيح/تفاصيل SMTP ولا إرسال تلقائي', () => {
  const decl = routeDecl('/api/diag/mail', 900);
  assert.ok(decl.includes('req.query.send'), 'الإرسال مقصود بمعلمة صريحة');
  assert.ok(decl.includes('sendResetEmail'), 'يستدعي الإرسال فقط عند الطلب');
  for (const leak of ['apiKeyPrefix', 'passLen', '.slice(0, 12)', 'user: MAIL_USER', 'from: MAIL_FROM', 'host: MAIL_HOST', 'port: MAIL_PORT', 'MAIL_PASS || \'\').length']) {
    assert.ok(!decl.includes(leak), 'لا يكشف: ' + leak);
  }
  assert.ok(decl.includes('{ configured }'), 'الرد محدود بحقل configured');
});

test('diag/smtp: معطّل افتراضياً في الإنتاج بلا ENABLE_SMTP_DIAG', () => {
  const decl = routeDecl('/api/diag/smtp', 400);
  assert.ok(decl.includes('ENABLE_SMTP_DIAG'), 'له حارس بيئي صريح');
  assert.ok(/ENABLE_SMTP_DIAG\s*!==\s*'1'/.test(decl), 'افتراضياً غير مفعّل');
  assert.ok(decl.includes("'smtp_diag_disabled'"), 'استجابة واضحة عند التعطيل');
});

test('health: استجابة صحة عامة بلا تفاصيل البريد الداخلية', () => {
  const i = SERVER.indexOf("app.get('/api/health'");
  assert.ok(i >= 0, '/api/health موجود');
  const decl = SERVER.slice(i, i + 500);
  assert.ok(decl.includes('mail: { configured:'), 'البريد مجرد علم configured');
  for (const leak of ['passLen', 'apiKeyPrefix', '.slice(0, 12)',
    'user: !!MAIL_USER', 'from: MAIL_FROM || null', 'port: MAIL_PORT', 'host: !!MAIL_HOST']) {
    assert.ok(!decl.includes(leak), 'health لا يكشف: ' + leak);
  }
});
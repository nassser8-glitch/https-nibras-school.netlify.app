'use strict';
/* =============================================================================
 * الحارس: حذف عبارة الوقف وعدم بيع التطبيق من جميع الملفات النشطة وكل الأدوار
 * ========================================================================== */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

const FORBIDDEN_PHRASES = [
  'وقف لله',
  'لا يجوز بيعه',
  'دون إذن كتابي',
  'دون اذن كتابي',
  '\\u0648\\u0642\\u0641',
  Buffer.from('وقف لله').toString('base64'),
];

const ACTIVE_FILES = [
  'public/index.html',
  'public/toolbar.js',
  'public/teachers-guide.html',
  'public/sw.js',
  'server.js',
  'db.js',
];

test('1) خلو الملفات النشطة من عبارة الوقف ومنع البيع', () => {
  for (const rel of ACTIVE_FILES) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) continue;
    const content = fs.readFileSync(p, 'utf8');
    for (const phrase of FORBIDDEN_PHRASES) {
      assert.ok(
        !content.includes(phrase),
        `وُجدت العبارة المحذوفة "${phrase}" في ${rel}`
      );
    }
  }
});

test('2) صفحة حول التطبيق renderAbout تخلو من العبارة في جميع الأدوار', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const start = html.indexOf('function renderAbout(){');
  const end = html.indexOf('function renderLayout(', start);
  assert.ok(start >= 0 && end > start, 'دالة renderAbout موجودة في public/index.html');
  const fnSource = html.slice(start, end);

  const roles = [
    'ADMIN',
    'AGENT',
    'SCHOOL_AGENT',
    'COUNSELOR',
    'ADMINISTRATIVE',
    'TEACHER',
    'STUDENT',
  ];

  for (const role of roles) {
    const context = {
      currentUser: () => ({ id: 'u1', name: 'مستخدم تجريبي', role }),
    };
    vm.createContext(context);
    vm.runInContext(fnSource, context);
    const out = context.renderAbout();

    assert.ok(out.includes('حول التطبيق'), `العنوان موجود لدور ${role}`);
    assert.ok(
      out.includes('جميع الحقوق محفوظة © 2026 ناصر العتيبي.</p>'),
      `سطر الحقوق محفوظ دون فاصل لدور ${role}`
    );
    assert.ok(!out.includes('وقف لله'), `خلو من وقف لله لدور ${role}`);
    assert.ok(!out.includes('لا يجوز بيعه'), `خلو من لا يجوز بيعه لدور ${role}`);
    assert.ok(!out.includes('ناصر العتيبي.<br>'), `لا يوجد فاصل <br> زائد لدور ${role}`);
  }
});

test('3) مطابقة إصدار Service Worker مع CACHE_NAME وتحديثه (>= 178)', () => {
  const sw = fs.readFileSync(path.join(ROOT, 'public', 'sw.js'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const cacheM = sw.match(/const CACHE_NAME = 'nibras-v(\d+)'/);
  const regM = html.match(/register\('sw\.js\?v=(\d+)'/);
  assert.ok(cacheM && regM, 'رقم الإصدار موجود في sw.js و index.html');
  assert.strictEqual(cacheM[1], regM[1], 'تطابق رقم CACHE_NAME مع sw.js?v=');
  assert.ok(Number(cacheM[1]) >= 178, 'رقم CACHE_NAME محدث إلى 178 أو أحدث');
});

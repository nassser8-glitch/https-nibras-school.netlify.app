'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const indexSrc = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

test('1. إعدادات Viewport واتجاه RTL ومنع التمرير الأفقي', () => {
  assert.match(indexSrc, /<html lang="ar" dir="rtl">/);
  assert.match(indexSrc, /<meta name="viewport" content="width=device-width, initial-scale=1\.0, viewport-fit=cover" \/>/);
  assert.match(indexSrc, /html,\s*body\s*\{\s*max-width:100%;\s*overflow-x:hidden;/);
  assert.match(indexSrc, /\.main\s*\{\s*overflow-x:hidden;\s*\}/);
});

test('2. توافق القائمة الجانبية والنوافذ المنبثقة على الهواتف والأجهزة اللوحية', () => {
  assert.match(indexSrc, /@media \(max-width:820px\)/);
  assert.match(indexSrc, /class="sidebar-mobile-head"/);
  assert.match(indexSrc, /class="sidebar-mobile-close" onclick="toggleSidebar\(true\)"/);
  assert.match(indexSrc, /onclick="if\(event\.target\.closest\('a'\)\) toggleSidebar\(true\)"/);
  assert.match(indexSrc, /\.modal-overlay\s*\{\s*z-index:1200;\s*\}/);
  assert.match(indexSrc, /@media \(max-width:768px\)/);
  assert.match(indexSrc, /max-height:calc\(100dvh - 16px\) !important/);
  assert.match(indexSrc, /\.modal-box \.modal-head\s*\{\s*position:sticky;/);
});

test('3. نقاط التوقف للشاشات الصغيرة (640px, 480px, 360px) وأحجام اللمس', () => {
  assert.match(indexSrc, /@media \(max-width:640px\)/);
  assert.match(indexSrc, /@media \(max-width:480px\)/);
  assert.match(indexSrc, /@media \(max-width:360px\)/);
  assert.match(indexSrc, /font-size:16px !important; min-height:40px/);
  assert.match(indexSrc, /\.table-card,\s*\.tbl-scroll\s*\{[^}]*-webkit-overflow-scrolling:touch;/);
});

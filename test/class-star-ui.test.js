'use strict';

// regression: إدارة نجمة الفصل من صفحة الفصول تحفظ الاختيار وتعيد عرضه عند التحميل.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const INDEX_HTML_PATH = path.join(__dirname, '..', 'public', 'index.html');

test('واجهة الفصول تعرض نجمة الفصل وتستعيد الاختيار المحفوظ', () => {
  const src = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
  assert.match(src, /const selectedId = c\.starStudentId \|\| ''/);
  assert.match(src, /aria-label="نجمة الفصل"/);
  assert.match(src, /s\.id === selectedId \? 'selected' : ''/);
  assert.match(src, /onchange="setClassStar\('\$\{c\.id\}', this\.value\)"/);
});

test('تعيين نجمة الفصل يتحقق من انتماء الطالبة للفصل قبل الحفظ', () => {
  const src = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
  assert.match(src, /function setClassStar\(classId, studentId\)/);
  assert.match(src, /s\.active && s\.id === studentId && s\.classId === classId/);
  assert.match(src, /cls\.starStudentId = student \? student\.id : null/);
  assert.match(src, /saveDB\(d\);\s+renderApp\(\);\s*\n\}/);
});

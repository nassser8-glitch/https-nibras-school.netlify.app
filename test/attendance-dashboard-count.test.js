'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('عداد حضور الطلاب يشمل المتأخرين ويعرض عدد التأخر مستقلاً دون مضاعفة الإجمالي', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const start = source.indexOf('const attGroup = (');
  const end = source.indexOf('\n  const tPresent =', start);
  assert.ok(start !== -1 && end > start, 'مُنشئ بطاقة الحضور موجود');

  const snippet = source.slice(start, end);
  const context = vm.createContext({});
  vm.runInContext(`${snippet}\nglobalThis.renderAttendanceGroup = attGroup;`, context);
  const html = context.renderAttendanceGroup('حضور الطلاب', 157, 5, 2, '96.9%', 'showTodayAttendance()', false, true);

  assert.match(html, /حضور\s*<b[^>]*>157<\/b>/, 'الحضور يشمل الطالبات المتأخرات');
  assert.match(html, /غياب\s*<b[^>]*>5<\/b>/, 'الغياب يبقى مستقلاً');
  assert.match(html, /تأخر\s*<b[^>]*>2<\/b>/, 'عدد المتأخرات يبقى ظاهراً مستقلاً');
  assert.match(html, /<b[^>]*>162<\/b>/, 'إجمالي المسجلات لا يكرر عدد المتأخرات');
});

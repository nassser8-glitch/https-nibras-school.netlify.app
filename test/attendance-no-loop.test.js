'use strict';
// لا حلقة إعادة رسم في صفحة الحضور: تحديث الحضور لا يعيد رسم الصفحة إلا عند تغيّر البيانات فعلاً.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const start = SRC.indexOf('/* تحديث الحضور من الخادم دون حلقة');
const end = SRC.indexOf('async function __starOfWeekLoad(school){');
if (start === -1 || end === -1) throw new Error('block not found');
const block = SRC.slice(start, end);

function build(attendanceSequence) {
  let renders = 0;
  let loads = 0;
  const ctx = {
    console,
    location: { hash: '#/attendance' },
    Date,
    Promise,
    setTimeout,
    __nowOverride: null,
    renderApp: () => { renders++; ctx.__renderHook && ctx.__renderHook(); },
    __attendanceLoad: () => {
      const arr = attendanceSequence[Math.min(loads, attendanceSequence.length - 1)];
      loads++;
      return Promise.resolve(arr);
    },
  };
  vm.createContext(ctx);
  vm.runInContext(block + '\nglobalThis.__refresh = __attendanceRefreshRender; globalThis.__att = __attRefresh;', ctx);
  return { ctx, get renders() { return renders; }, get loads() { return loads; } };
}

const tick = () => new Promise(r => setImmediate(r));

test('تكرار نفس البيانات لا يسبب إعادة رسم إضافية', async () => {
  const data = [{ id: 'a1', status: 'PRESENT', _t: 1, studentId: 's', date: 'd' }];
  const h = build([data, data, data]);
  h.ctx.__refresh('GIRLS');
  await tick();
  assert.equal(h.renders, 1, 'أول تحميل يرسم مرة واحدة');
  h.ctx.__att.at = 0;
  h.ctx.__refresh('GIRLS');
  await tick();
  assert.equal(h.renders, 1, 'نفس البيانات لا ترسم مرة أخرى');
});

test('الحلقة تتوقف: renderApp يعيد الاستدعاء ولا يتكرر الرسم', async () => {
  const data = [{ id: 'a1', status: 'PRESENT', _t: 1, studentId: 's', date: 'd' }];
  const h = build([data]);
  h.ctx.__renderHook = () => { h.ctx.__refresh('GIRLS'); };
  h.ctx.__refresh('GIRLS');
  await tick(); await tick(); await tick();
  assert.ok(h.renders <= 2, 'لا حلقة لا نهائية (renders=' + h.renders + ')');
});

test('طلب قائم يمنع طلباً ثانياً متزامناً', async () => {
  const data = [{ id: 'a1', status: 'PRESENT', _t: 1, studentId: 's', date: 'd' }];
  const h = build([data]);
  h.ctx.__refresh('GIRLS');
  h.ctx.__refresh('GIRLS');
  h.ctx.__refresh('GIRLS');
  await tick();
  assert.equal(h.loads, 1, 'طلب واحد فقط أثناء الطلب القائم أو خلال 3 ثوانٍ');
});

test('تغيّر البيانات فعلاً يعيد الرسم مرة واحدة', async () => {
  const a = [{ id: 'a1', status: 'PRESENT', _t: 1, studentId: 's', date: 'd' }];
  const b = a.concat([{ id: 'a2', status: 'ABSENT', _t: 2, studentId: 's2', date: 'd' }]);
  const h = build([a, b]);
  h.ctx.__refresh('GIRLS');
  await tick();
  h.ctx.__att.at = 0;
  h.ctx.__refresh('GIRLS');
  await tick();
  assert.equal(h.renders, 2, 'تغيّر حقيقي يسبب رسماً واحداً إضافياً');
});

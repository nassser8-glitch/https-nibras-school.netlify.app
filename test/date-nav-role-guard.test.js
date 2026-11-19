'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

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

function makeHarness(role) {
  let rendered = 0;
  const stripEl = { innerHTML: '' };
  const store = {};
  const ctx = {
    __NAV_WEEKDAYS: ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'],
    __NAV_MONTHS: ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'],
    todayStr: () => '2026-11-19',
    isbDateStr: () => '2026-11-19',
    hijriIslamabad: () => '9 جمادى الآخرة 1448 هـ',
    currentUser: () => (role ? { id: 'u1', role, name: 'مستخدم' } : null),
    localStorage: {
      getItem: (k) => store[k] || null,
      setItem: (k, v) => { store[k] = String(v); },
    },
    window: { __appStripClock: 1 },
    document: { getElementById: (id) => (id === 'appStrip' ? stripEl : null) },
    __stripWxRender: () => {},
    renderApp: () => { rendered++; },
    attendanceState: { date: '2026-11-19' },
  };
  vm.createContext(ctx);
  vm.runInContext(
    [
      'let __navDate = "2026-11-19";',
      extractFn(HTML, '__fmtNavDate'),
      extractFn(HTML, '__addDaysIso'),
      extractFn(HTML, 'canNavigateDate'),
      extractFn(HTML, '__setNavDate'),
      extractFn(HTML, '__navPrev'),
      extractFn(HTML, '__navNext'),
      extractFn(HTML, '__navToday'),
      extractFn(HTML, 'renderAppStrip'),
      'globalThis.getNavDate = () => __navDate;',
      'globalThis.canNavigateDate = canNavigateDate;',
      'globalThis.__navPrev = __navPrev;',
      'globalThis.__navNext = __navNext;',
      'globalThis.__navToday = __navToday;',
      'globalThis.__setNavDate = __setNavDate;',
      'globalThis.renderAppStrip = renderAppStrip;',
    ].join('\n'),
    ctx
  );
  return { ctx, stripEl, getRendered: () => rendered };
}

test('1) المدير والوكيل/الوكيلة (ADMIN و AGENT): تظهر أسهم التنقل ويعمل الانتقال للسابق والتالي واليوم', () => {
  for (const role of ['ADMIN', 'AGENT']) {
    const { ctx, stripEl } = makeHarness(role);
    assert.equal(ctx.canNavigateDate(), true, `${role} يجب أن يكون مخولاً`);
    ctx.renderAppStrip();
    assert.ok(stripEl.innerHTML.includes('id="stripSelDate"'), 'التاريخ ظاهر');
    assert.ok(stripEl.innerHTML.includes('onclick="__navPrev()"'), `${role}: سهم السابق ظاهر`);
    assert.ok(stripEl.innerHTML.includes('onclick="__navNext()"'), `${role}: سهم التالي ظاهر`);

    ctx.__navPrev();
    assert.equal(ctx.getNavDate(), '2026-11-18', `${role}: الانتقال لليوم السابق يعمل`);
    ctx.__navNext();
    assert.equal(ctx.getNavDate(), '2026-11-19', `${role}: الانتقال لليوم التالي يعمل`);
    ctx.__navNext();
    assert.equal(ctx.getNavDate(), '2026-11-20', `${role}: الانتقال لليوم بعده يعمل`);
    ctx.__navToday();
    assert.equal(ctx.getNavDate(), '2026-11-19', `${role}: العودة لليوم تعمل`);
  }
});

test('2) المعلم/المعلمة وبقية الأدوار غير المخولة: تختفي الأسهم، يبقى التاريخ ظاهرًا، وتُرفض محاولة تغيير التاريخ برمجيًا', () => {
  for (const role of ['TEACHER', 'COUNSELOR', 'ADMINISTRATIVE', 'SCHOOL_AGENT', 'STUDENT', null]) {
    const { ctx, stripEl, getRendered } = makeHarness(role);
    assert.equal(ctx.canNavigateDate(), false, `${role} غير مخول`);
    ctx.renderAppStrip();
    assert.ok(stripEl.innerHTML.includes('id="stripSelDate"'), `${role}: التاريخ يبقى ظاهرًا`);
    assert.ok(!stripEl.innerHTML.includes('__navPrev'), `${role}: سهم السابق مخفي تمامًا`);
    assert.ok(!stripEl.innerHTML.includes('__navNext'), `${role}: سهم التالي مخفي تمامًا`);
    assert.ok(!stripEl.innerHTML.includes('__navToday'), `${role}: زر اليوم مخفي`);
    assert.ok(!stripEl.innerHTML.includes('◀'), `${role}: رمز ◀ غير موجود`);
    assert.ok(!stripEl.innerHTML.includes('▶'), `${role}: رمز ▶ غير موجود`);

    // محاولة استدعاء الدوال مباشرة من الكونسول أو الواجهة لا تغيّر التاريخ
    ctx.__navPrev();
    ctx.__navNext();
    ctx.__setNavDate('2026-11-10');
    ctx.__navToday();
    assert.equal(ctx.getNavDate(), '2026-11-19', `${role}: التاريخ لم يتغير`);
    assert.equal(getRendered(), 0, `${role}: لم يُعد رسم الصفحة بتغيير غير مصرح به`);
  }
});

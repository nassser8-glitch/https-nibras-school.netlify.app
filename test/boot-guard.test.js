'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'public');
const HTML = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
const SW = fs.readFileSync(path.join(PUB, 'sw.js'), 'utf8');

test('1) جميع ملفات <script src> في public/index.html موجودة فعليًا ولا توجد ملفات 404، وxlsx محمّل بـ defer', () => {
  const firstLine = HTML.split(/\r?\n/)[0].trim();
  assert.equal(firstLine, '<!DOCTYPE html>', 'السطر الأول يجب أن يكون DOCTYPE نظيفًا');
  assert.ok(HTML.includes('<script defer src="vendor/xlsx.full.min.js"></script>'), 'xlsx يجب أن يكون defer');

  const srcs = [...HTML.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/gi)].map(m => m[1]);
  assert.ok(srcs.length >= 2, 'يجب وجود السكربتات الأساسية');
  for (const raw of srcs) {
    const rel = raw.split('?')[0].replace(/^\/+/, '');
    const full = path.join(PUB, rel);
    assert.ok(fs.existsSync(full), `الملف المشار إليه غير موجود (404): ${raw}`);
  }
});

test('2) رقم إصدار Service Worker في sw.js يطابق رقم التسجيل في index.html (nibras-v177)', () => {
  const cacheM = SW.match(/const CACHE_NAME = 'nibras-v(\d+)'/);
  const regM = HTML.match(/register\('sw\.js\?v=(\d+)'/);
  assert.ok(cacheM && regM, 'يجب وجود رقم إصدار في sw.js و index.html');
  assert.equal(cacheM[1], regM[1], 'رقم CACHE_NAME يجب أن يطابق sw.js?v');
});

test('3) جميع كتل <script> المدمجة في index.html سليمة نحويًا ولا تحتوي أخطاء SyntaxError', () => {
  const blocks = [...HTML.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]).filter(s => s.trim());
  assert.ok(blocks.length >= 3);
  blocks.forEach((code, i) => {
    assert.doesNotThrow(() => new vm.Script(code, { filename: `girls-inline-${i + 1}.js` }), `خطأ صياغة في الكتلة ${i + 1}`);
  });
});

test('4) حارس الإقلاع في البنات: لا إنذار كاذب مع بطء الشبكة/Render/Neon، مسح علامة الإصلاح عند النجاح، وعرض الخطأ الحقيقي عند الفشل', () => {
  const firstScriptMatch = HTML.match(/<script>([\s\S]*?)<\/script>/i);
  assert.ok(firstScriptMatch);
  const bootCode = firstScriptMatch[1];

  function runBootSim(initialRepairFlag) {
    const store = initialRepairFlag ? { nibrasBootRepair_v1: '1' } : {};
    const appended = [];
    const listeners = {};
    let timerFn = null;
    let timerCleared = false;
    let reloaded = false;
    const body = {
      appendChild: (el) => { appended.push(el); el.parentNode = body; },
      removeChild: (el) => { const idx = appended.indexOf(el); if (idx >= 0) appended.splice(idx, 1); },
    };
    const ctx = {
      window: null,
      sessionStorage: {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; },
      },
      navigator: {},
      location: { reload: () => { reloaded = true; } },
      document: {
        body,
        createElement: (tag) => ({ tag, style: {}, setAttribute: () => {}, innerHTML: '', id: '' }),
        getElementById: (id) => appended.find(x => x.id === id) || null,
      },
      setTimeout: (fn) => { timerFn = fn; return 42; },
      clearTimeout: () => { timerCleared = true; },
    };
    ctx.window = ctx;
    ctx.addEventListener = (ev, fn) => { listeners[ev] = fn; };
    vm.createContext(ctx);
    vm.runInContext(bootCode, ctx);
    return { ctx, store, appended, listeners, fireTimer: () => timerFn && timerFn(), isReloaded: () => reloaded, isCleared: () => timerCleared };
  }

  // أ) بطء Render/Neon بعد تحميل السكربت الرئيسي بنجاح: لا إنذار كاذب ولا إعادة تحميل
  const slow = runBootSim(false);
  assert.equal(slow.store.nibrasBootRepair_v1, undefined, 'لا تُكتب علامة الإصلاح على تحميل طبيعي');
  slow.ctx.__nibrasScriptLoaded = true;
  slow.fireTimer();
  assert.equal(slow.appended.length, 0, 'لا يظهر صندوق الخطأ لأن السكربت حُمِّل وينتظر الشبكة');
  assert.equal(slow.isReloaded(), false, 'لا يُعاد التحميل بلا داعٍ');
  slow.ctx.__nibrasMarkBooted();
  assert.equal(slow.ctx.__nibrasBooted, true);
  assert.equal(slow.isCleared(), true);

  // ب) خطأ مورد غير حرج لا يلوّث __nibrasBootErr
  const resErr = runBootSim(false);
  resErr.listeners.error({ type: 'error', target: { tagName: 'IMG' } });
  assert.equal(resErr.ctx.__nibrasBootErr, '');

  // ج) فشل حقيقي قبل تحميل السكربت في المحاولة الثانية: يظهر صندوق الخطأ فعلاً (لا إخفاء للأخطاء الحقيقية)
  const realFail = runBootSim(true);
  realFail.listeners.error({ message: 'SyntaxError: girls boot test' });
  realFail.fireTimer();
  assert.equal(realFail.appended.length, 1, 'يظهر صندوق الخطأ عند فشل حقيقي');
  assert.ok(realFail.appended[0].innerHTML.includes('SyntaxError: girls boot test'));
  realFail.ctx.__nibrasMarkBooted();
  assert.equal(realFail.appended.length, 0);
  assert.equal(realFail.store.nibrasBootRepair_v1, undefined);
});

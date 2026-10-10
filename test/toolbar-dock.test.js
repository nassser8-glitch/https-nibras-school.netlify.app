'use strict';
/* مرسى شريط البنات تحت بطاقة «المتواجدات في الموقع» — شريط الأيقونات نفسه من قسم
 * البنين: ست أدوات في صفّين (3+3) تظهر تحت البطاقة ويفتح كلّ منها لوحته.
 * نحمّل public/toolbar.js الحقيقي في بيئة DOM وهمية تحوي نقطة المرسى.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'public', 'toolbar.js'), 'utf8');

function makeEl(id) {
  const el = {
    id: id || '', tagName: 'DIV', className: '', innerHTML: '', textContent: '', value: '',
    attrs: {}, children: [], parentNode: null, isConnected: true, style: {},
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    removeAttribute(k) { delete this.attrs[k]; },
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    _l: {},
    addEventListener(t, fn) { (this._l[t] = this._l[t] || []).push(fn); },
    removeEventListener() {},
    setAttributeNS() {}
  };
  return el;
}
function fire(el, type, ev) {
  const e = ev || {};
  e.target = e.target || el;
  e.preventDefault = e.preventDefault || function () {};
  for (const fn of (el._l[type] || [])) fn(e);
}
function findBySel(root, sel) {
  const m = /^#([\w-]+)$/.exec(sel);
  if (!m) return null;
  const stack = [root];
  while (stack.length) {
    const n = stack.shift();
    if (n.id === m[1]) return n;
    const h = typeof n.innerHTML === 'string' ? n.innerHTML : '';
    if (h.indexOf('id="' + m[1] + '"') > -1) {
      const fake = makeEl(m[1]);
      fake.innerHTML = h;
      return fake;
    }
    for (const c of n.children) stack.push(c);
  }
  return null;
}
function makeStore() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k)
  };
}
function loadDocked() {
  const store = makeStore();
  const dock = makeEl('nibrasToolbarDock');
  const body = makeEl('body');
  body.appendChild(dock);
  const doc = {
    readyState: 'complete', body,
    documentElement: { dir: 'rtl' },
    createElement: () => makeEl(''),
    addEventListener() {},
    getElementById: id => (id === 'nibrasToolbarDock' ? dock : findBySel(dock, '#' + id))
  };
  const ctx = {
    window: {}, document: doc, localStorage: store, navigator: {},
    Intl, Date, Math, JSON, Object, Array, String, Number, isFinite, parseFloat, parseInt, encodeURIComponent,
    setTimeout() {}, setInterval() {}, clearTimeout() {}, clearInterval() {},
    console, fetch: () => Promise.reject(new Error('offline'))
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: 'toolbar.js' });
  return { api: ctx.window.__tb, ctx, dock, body };
}

test('dock: index.html يضع المرسى فوراً بعد بطاقة المتواجدات', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  assert.ok(html.includes('<div id="presentNowBox"></div><div id="nibrasToolbarDock"></div>'),
    'نقطة المرسى تحت بطاقة المتواجدات');
  const i = html.indexOf("function updatePresentNow(){");
  assert.ok(i >= 0 && html.slice(i, i + 2000).includes('__tb.redock'),
    'updatePresentNow يعيد المرسى بعد كل رسم حضور');
});

test('dock: الشريط حقيقي ويعرض صفّ الأيقونات عند المرسى', () => {
  const t = loadDocked();
  assert.equal(t.ctx.window.__tbState, 'painted', 'يصل إلى حالة painted');
  t.api.redock();
  const root = t.dock.children.find(c => c.id === 'nibrasToolbar');
  assert.ok(root, 'الجذر انتقل إلى داخل نقطة المرسى');
  assert.equal(root.parentNode, t.dock, 'معلّق داخل المرسى وليس في body');
  const icons = (root.innerHTML.match(/data-tab="[a-z]"/g) || []);
  assert.equal(icons.length, 6, 'ستة أيقونات ظاهرة');
  const side = findBySel(root, '.tb-side');
  assert.ok((side && true) || /class="tb-side"/.test(root.innerHTML), 'الجذر يحمل حاوية .tb-side');
});

test('dock: فتح أيقونة يبسّط اللوحة بلا تكرار التبويب الداخلي', () => {
  const t = loadDocked();
  t.api.redock();
  let root = t.dock.children.find(c => c.id === 'nibrasToolbar');
  assert.ok(root, 'المرسى جاهز');
  fire(root, 'click', { target: { id: '', getAttribute: k => (k === 'data-tab' ? 'w' : null) } });
  root = t.dock.children.filter(c => c.id === 'nibrasToolbar').pop();
  assert.ok(/tbPanel/.test(root.innerHTML), 'اللوحة فُتحت');
  assert.ok(/tbBody/.test(root.innerHTML), 'حاوية المحتوى موجودة');
  assert.ok(!/class="tb-tab"/.test(root.innerHTML), 'لا تبويب داخلي مكرر عند المرسى');
  assert.ok(t.api.lsGet('open', false), 'حالة الفتح محفوظة');
});

test('dock: css يصف صفّين (3+3) والمرسى', () => {
  const css = fs.readFileSync(path.join(ROOT, 'public', 'toolbar.css'), 'utf8');
  assert.ok(/\.tb-side\s*\{[^}]*grid-template-columns:repeat\(3,\s*1fr\)/.test(css),
    'مسار تكرار أفقي لثلاثة — صفّان من ثلاثة');
  assert.ok(/\.tb-root\.tb-docked/.test(css), 'أنماط المرسى موجودة');
  assert.ok(/\.tb-side-i/.test(css), 'أنماط زر الأيقونة موجودة');
});

test('dock: الأدوات الست كلّها مُسجّلة في الشريط الجانبي', () => {
  const src = SRC;
  assert.ok(/var DOCK = false;/.test(src), 'علم المرسى موجود');
  assert.ok(/function sideHTML\(\)/.test(src), 'عرض الصف الجانبي موجود');
  assert.ok(/function reDock\(\)/.test(src), 'إعادة المرسى موجودة');
  assert.ok(/redock: reDock/.test(src), 'مُصدَّر للصفحة الرئيسية');
});

test('dock: تقويم المرسى — الترويسة ميلادية وليست هجرية (أكتوبر لا شوال)', () => {
  const src = SRC;
  assert.ok(/var AR_GREG = /.test(src), 'قائمة الأشهر الميلادية العربية يجب أن تكون معرّفة');
  assert.ok(src.includes('var EN_GREG = '), 'قائمة الأشهر الميلادية الإنجليزية يجب أن تكون معرّفة');
  assert.ok(/var mn = en \? EN_GREG\[m\] : AR_GREG\[m\];/.test(src),
    'الترويسة تُبنى من الأشهر الميلادية وليس من قائمة الأشهر الهجرية');
  assert.ok(!/var mn = en \? EN_MONTHS\[m\] : AR_MONTHS\[m\];/.test(src),
    'لا يجب أن تظهر الترويسة اسم شهر هجري (مثل شوال لأكتوبر)');
  const t = loadDocked();
  const box = makeEl('tbBody');
  t.api.calRender(box);
  const head = ((box.innerHTML.match(/tb-cal-head[\s\S]*?<span>([^<]*)<\/span>/) || [])[1] || '').trim();
  const greg = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  assert.ok(head.includes(greg[new Date().getMonth()]), 'ترويسة التقويم = الشهر الميلادي الجاري، كان: ' + head);
  const hijriNames = ['محرم', 'صفر', 'ربيع الأول', 'ربيع الآخر', 'جمادى الأولى', 'جمادى الآخرة', 'رجب', 'شعبان', 'رمضان', 'شوال', 'ذو القعدة', 'ذو الحجة'];
  for (const n of hijriNames) assert.ok(head.indexOf(n) === -1, 'الترويسة لا تحمل اسم شهر هجري: ' + n);
  const foot = ((box.innerHTML.match(/<div class="tb-cal-f">([^<]*)<\/div>/) || [])[1] || '').trim();
  assert.ok(/هـ/.test(foot) && /1448/.test(foot), 'السطر الهجري السفلي يبقى صحيحاً: ' + foot);
});
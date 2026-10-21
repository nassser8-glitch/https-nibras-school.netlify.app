'use strict';
/* بطاقة شكر احتفالية للمعلمات: اختيار المعلمة + نص الركر ثم احتفال مؤقت
   (ألعاب نارية + ورود) حول البطاقة دون حجب الاسم أو النص، مع احترام
   prefers-reduced-motion وإيقاف/إعادة تشغيل الحركة. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

function extractFn(src, name){
  const start = src.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'دالة مفقودة: ' + name);
  const open = src.indexOf('{', start);
  let depth = 0;
  for(let i = open; i < src.length; i++){
    if(src[i] === '{') depth++;
    else if(src[i] === '}'){ depth--; if(depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('دالة غير مغلقة: ' + name);
}

const FNS = ['thanksReducedMotion', 'renderThanksCard', 'thanksShowCard', 'thanksOpen', 'thanksReplay', 'thanksStopMotion', 'thanksClose', 'thanksStartFx'];
const CODE = 'let thanksPrefill = null;\nlet __thanksState = null;\nlet __thanksFx = null;\n' + FNS.map(n => extractFn(SRC, n)).join('\n') + `
;globalThis.__thanksApi = {
  renderThanksCard, thanksShowCard, thanksOpen, thanksReplay, thanksStopMotion, thanksClose, thanksStartFx, thanksReducedMotion,
  setPrefill: v => { thanksPrefill = v; },
  getState: () => __thanksState,
  getFx: () => __thanksFx
};`;

const DB = {
  users: [
    { id:'t1', role:'TEACHER', name:'شادية' },
    { id:'t2', role:'TEACHER', name:'نورة' },
    { id:'t3', role:'TEACHER', name:'بائنة', active:false },
    { id:'a1', role:'ADMIN', name:'المديرة' }
  ]
};

const CTX_STUB = {
  clearRect(){}, beginPath(){}, arc(){}, fill(){},
  globalAlpha:1, fillStyle:'', globalCompositeOperation:''
};

function makeEl(doc, id){
  const el = {
    id: id || '', className: '', textContent: '', _html: '', onclick: null, parentNode: null,
    children: [], parsed: [], offsetWidth: 1,
    style: { display: '', setProperty(k, v){ this[k] = v; } },
    classList: { _c: new Set(), add(c){ this._c.add(c); }, remove(c){ this._c.delete(c); }, contains(c){ return this._c.has(c); } },
    appendChild(c){ this.children.push(c); c.parentNode = this; return c; },
    getBoundingClientRect: () => ({ width: 400, height: 720 }),
    getContext: () => CTX_STUB
  };
  Object.defineProperty(el, 'innerHTML', {
    set(v){
      el._html = v;
      el.parsed = [];
      const re = /id="([^"]+)"/g;
      let m;
      while((m = re.exec(v))){ const child = makeEl(doc, m[1]); child.parentNode = el; el.parsed.push(child); }
    },
    get(){ return el._html; }
  });
  return el;
}

function makeDoc(){
  const doc = { body: null, _top: [] };
  doc.body = {
    children: doc._top,
    appendChild(el){ doc._top.push(el); el.parentNode = doc.body; return el; },
    removeChild(el){ const i = doc._top.indexOf(el); if(i >= 0) doc._top.splice(i, 1); el.parentNode = null; return el; }
  };
  doc.createElement = () => makeEl(doc, '');
  const find = (el, id) => {
    if(!el) return null;
    if(el.id === id) return el;
    for(const c of (el.children || [])){ const r = find(c, id); if(r) return r; }
    for(const c of (el.parsed || [])){ const r = find(c, id); if(r) return r; }
    return null;
  };
  doc.getElementById = id => find({ children: doc._top }, id) || null;
  return doc;
}

function buildCtx(opts){
  const o = opts || {};
  const doc = makeDoc();
  const rafs = [];
  const ctx = {
    console,
    document: doc,
    window: {
      matchMedia: () => ({ matches: !!o.reduceMotion }),
      addEventListener(){}, removeEventListener(){}
    },
    loadDB: () => o.db || DB,
    displayName: u => (u && u.name) || '',
    escapeHtml: s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    requestAnimationFrame: cb => { rafs.push(cb); return rafs.length; },
    cancelAnimationFrame(){},
    setTimeout: () => 1,
    clearTimeout(){}
  };
  vm.createContext(ctx);
  vm.runInContext(CODE, ctx);
  ctx.__doc = doc;
  ctx.__rafs = rafs;
  return ctx;
}

test('البوابة: صفحة thanks للمدير فقط في المسار والقائمة، والإصدار مرفوع', () => {
  assert.ok(SRC.includes("page === 'thanks' && user.role === 'ADMIN'"), 'المسار مقيد بالمدير');
  assert.ok(/\(user\.role === 'ADMIN'\) \? \{ href:'#\/thanks', key:'thanks'/.test(SRC), 'رابط القائمة للمدير فقط');
  const ver = SRC.match(/const __APP_VER = '([^']+)'/);
  assert.ok(ver && ver[1].includes('thanks-card'), 'بند الإصدار thanks-card');
  assert.ok(SRC.includes('let thanksPrefill = null;') && SRC.includes('let __thanksState = null;') && SRC.includes('let __thanksFx = null;'), 'متغيّرات الحالة موجودة في المصدر');
});

test('الأنماط: طبقة البطاقة فوق المؤثرات + احترام تقليل الحركة', () => {
  assert.ok(SRC.includes('.thanks-overlay{'), 'طبقة الاحتفال موجودة');
  assert.ok(SRC.includes('@keyframes thanks-fall'), 'حركة الورود المتناثرة موجودة');
  assert.ok(SRC.includes('@keyframes thanks-pop'), 'حركة دخول البطاقة موجودة');
  assert.ok(SRC.includes('prefers-reduced-motion: reduce'), 'وسيط تقليل الحركة موجود');
  assert.ok(SRC.includes('.thanks-card, .thanks-card.thanks-pop, .thanks-petal{ animation:none !important; }'), 'إطفاء الحركة عند التقليل');
  assert.ok(SRC.includes('.thanks-card{ position:relative; z-index:2;'), 'البطاقة فوق المؤثرات فلا يحجب النص');
});

test('renderThanksCard: قوائم المعلمات النشيطات فقط + نص + زر العرض', () => {
  const ctx = buildCtx();
  const html = ctx.__thanksApi.renderThanksCard();
  assert.ok(html.includes('شادية') && html.includes('نورة'), 'المعلمات النشيطات في القائمة');
  assert.ok(!html.includes('بائنة'), 'المعلمة غير النشطة خارج القائمة');
  assert.ok(!html.includes('المديرة'), 'غير المعلمات خارج القائمة');
  assert.ok(html.includes('id="thanksTeacher"'), 'حقل اختيار المعلمة');
  assert.ok(html.includes('id="thanksMsg"'), 'حقل نص الرسالة');
  assert.ok(html.includes('maxlength="400"'), 'حد لنص الرسالة');
  assert.ok(html.includes('thanksShowCard()'), 'زر عرض البطاقة موصول');
});

test('renderThanksCard: thanksPrefill يسبق الاختيار مرة واحدة ثم يُستهلك', () => {
  const ctx = buildCtx();
  ctx.__thanksApi.setPrefill('t1');
  const html = ctx.__thanksApi.renderThanksCard();
  assert.ok(/value="t1"\s+selected/.test(html), 'المعلمة المسبقة مختارة');
  const html2 = ctx.__thanksApi.renderThanksCard();
  assert.ok(!/value="t1"\s+selected/.test(html2), 'المسبقة تُستهلك ولا تبقى بعد التنقّل');
});

test('زر متابعة المعلم يفتح thanks مع تعبئة المعلمة (للمدير فقط)', () => {
  const page = extractFn(SRC, 'renderTeacherPage');
  assert.ok(page.includes("thanksPrefill='${escapeHtml(user.id)}'"), 'زر التعبئة موجود');
  assert.ok(page.includes("location.hash='#/thanks'"), 'ينتقل إلى صفحة البطاقة');
  assert.ok(page.includes('isAdmin ? `'), 'الزر مشروط بدور المدير');
});

test('thanksShowCard: بلا اختيار أو بلا نص رسالة — تلميح ولا بطاقة', () => {
  const ctx = buildCtx();
  const doc = ctx.__doc;
  const sel = doc.createElement('select'); sel.id = 'thanksTeacher'; sel.value = '';
  const ta = doc.createElement('textarea'); ta.id = 'thanksMsg'; ta.value = '  ';
  const hint = doc.createElement('p'); hint.id = 'thanksHint';
  doc.body.appendChild(sel); doc.body.appendChild(ta); doc.body.appendChild(hint);
  ctx.__thanksApi.thanksShowCard();
  assert.ok(hint.textContent.includes('اختاري المعلمة'), 'تلميح اختيار المعلمة');
  assert.equal(ctx.__thanksApi.getState(), null, 'لا بطاقة بلا اختيار');
  sel.value = 't1';
  ctx.__thanksApi.thanksShowCard();
  assert.ok(hint.textContent.includes('اكتبي نص رسالة الشكر'), 'تلميح كتابة الرسالة');
  assert.equal(ctx.__thanksApi.getState(), null, 'لا بطاقة بلا نص');
});

test('thanksShowCard: معلمة غير موجودة — تلميح ولا بطاقة', () => {
  const ctx = buildCtx();
  const doc = ctx.__doc;
  const sel = doc.createElement('select'); sel.id = 'thanksTeacher'; sel.value = 'ghost';
  const ta = doc.createElement('textarea'); ta.id = 'thanksMsg'; ta.value = 'شكراً';
  const hint = doc.createElement('p'); hint.id = 'thanksHint';
  doc.body.appendChild(sel); doc.body.appendChild(ta); doc.body.appendChild(hint);
  ctx.__thanksApi.thanksShowCard();
  assert.ok(hint.textContent.includes('غير موجودة'), 'تلميح الغياب');
  assert.equal(ctx.__thanksApi.getState(), null, 'لا بطاقة لمعلمة مفقودة');
});

test('thanksShowCard: اختيار صحيح + نص → تُفتح البطاقة باسمها', () => {
  const ctx = buildCtx();
  const doc = ctx.__doc;
  const sel = doc.createElement('select'); sel.id = 'thanksTeacher'; sel.value = 't2';
  const ta = doc.createElement('textarea'); ta.id = 'thanksMsg'; ta.value = 'شكراً لكِ يا أستاذة';
  const hint = doc.createElement('p'); hint.id = 'thanksHint';
  doc.body.appendChild(sel); doc.body.appendChild(ta); doc.body.appendChild(hint);
  ctx.__thanksApi.thanksShowCard();
  const st = ctx.__thanksApi.getState();
  assert.ok(st, 'البطاقة مفتوحة');
  assert.equal(st.name, 'نورة', 'الاسم من حساب المعلمة');
  assert.equal(st.msg, 'شكراً لكِ يا أستاذة', 'النص كما كُتب');
  assert.equal(hint.textContent, '', 'التلميح فارغ عند النجاح');
});

test('thanksOpen: الاسم والنص يُهرَّبان — لا HTML خام من المستخدم', () => {
  const ctx = buildCtx();
  ctx.__thanksApi.thanksOpen('<img src=x onerror=alert(1)>', 'مرحباً <script>bad()</script>');
  const ov = ctx.__doc.getElementById('thanksOverlay');
  assert.ok(ov, 'الطبقة مرفوعة');
  assert.ok(ov.innerHTML.includes('&lt;img src=x onerror=alert(1)&gt;'), 'الاسم مهرَّب');
  assert.ok(ov.innerHTML.includes('&lt;script&gt;bad()&lt;/script&gt;'), 'النص مهرَّب');
  assert.ok(!ov.innerHTML.includes('<img src=x'), 'لا عنصر خام');
  assert.ok(!ov.innerHTML.includes('<script>'), 'لا سكربت خام');
});

test('تشغيل عادي: دخول متحرك + ألعاب نارية + ورود + زر إيقاف وإعادة', () => {
  const ctx = buildCtx();
  ctx.__thanksApi.thanksOpen('شادية', 'شكراً');
  const ov = ctx.__doc.getElementById('thanksOverlay');
  assert.ok(ov.innerHTML.includes('thanks-pop'), 'دخول البطاقة متحرك');
  assert.ok(ov.innerHTML.includes('إيقاف الحركة'), 'زر إيقاف الحركة حاضر');
  assert.ok(ov.innerHTML.includes('إعادة الاحتفال'), 'زر إعادة الاحتفال حاضر');
  assert.ok(ov.innerHTML.includes(' thanks-petal"') || ov.innerHTML.includes('thanks-petal'), 'عنصر الورود في البنية');
  assert.ok(ctx.__rafs.length >= 1, 'حلقة الألعاب النارية انطلقت');
  const fx = ctx.__thanksApi.getFx();
  assert.ok(fx && fx.canvas && fx.ctx, 'حالة المؤثرات مسجلة');
});

test('تقليل الحركة: بلا أفلام ولا مؤثرات ولا أزرار حركة — البطاقة ساكنة', () => {
  const ctx = buildCtx({ reduceMotion: true });
  ctx.__thanksApi.thanksOpen('شادية', 'شكراً');
  const ov = ctx.__doc.getElementById('thanksOverlay');
  assert.ok(!ov.innerHTML.includes('thanks-pop'), 'لا حركة دخول');
  assert.ok(!ov.innerHTML.includes('إيقاف الحركة'), 'لا زر إيقاف بلا حركة');
  assert.ok(!ov.innerHTML.includes('إعادة الاحتفال'), 'لا زر إعادة بلا حركة');
  assert.equal(ctx.__thanksApi.getFx(), null, 'لا مؤثرات تعمل');
  assert.ok(ov.innerHTML.includes('✕ إغلاق'), 'الإغلاق يبقى');
  assert.ok(ov.innerHTML.includes('شادية'), 'الاسم يظهر ساكناً');
});

test('إيقاف الحركة: يلغي المؤثرات ويُخفي زر الإيقاف وتبقى البطاقة', () => {
  const ctx = buildCtx();
  ctx.__thanksApi.thanksOpen('شادية', 'شكراً');
  ctx.__thanksApi.thanksStopMotion();
  assert.equal(ctx.__thanksApi.getFx(), null, 'لا مؤثرات بعد الإيقاف');
  const ov = ctx.__doc.getElementById('thanksOverlay');
  assert.ok(ov, 'البطاقة مازالت مفتوحة');
  const petals = ctx.__doc.getElementById('thanksPetals');
  assert.equal(petals.innerHTML, '', 'الورود أُزيلت');
  const stopBtn = ctx.__doc.getElementById('thanksStopBtn');
  assert.equal(stopBtn.style.display, 'none', 'زر الإيقاف مخفي');
});

test('إعادة الاحتفال: تعيد الحركة بعد الإيقاف', () => {
  const ctx = buildCtx();
  ctx.__thanksApi.thanksOpen('شادية', 'شكراً');
  ctx.__thanksApi.thanksStopMotion();
  ctx.__thanksApi.thanksReplay();
  assert.ok(ctx.__thanksApi.getFx(), 'المؤثرات عادت');
  const card = ctx.__doc.getElementById('thanksCard');
  assert.ok(card.classList.contains('thanks-pop'), 'حركة الدخول عادت');
});

test('الإغلاق: يزيل الطبقة والمؤثرات والحالة', () => {
  const ctx = buildCtx();
  ctx.__thanksApi.thanksOpen('شادية', 'شكراً');
  ctx.__thanksApi.thanksClose();
  assert.equal(ctx.__doc.getElementById('thanksOverlay'), null, 'الطبقة مزالة');
  assert.equal(ctx.__thanksApi.getState(), null, 'الحالة فارغة');
  assert.equal(ctx.__thanksApi.getFx(), null, 'المؤثرات ملغاة');
  assert.equal(ctx.__doc._top.length, 0, 'لا شيء متبقي في الصفحة');
});

test('سقف الأمان: الألعاب النارية تنتهي تلقائياً وتنظف نفسها', () => {
  const fxCode = extractFn(SRC, 'thanksStartFx');
  assert.ok(fxCode.includes('12000'), 'سقف 12 ثانية للمؤثرات');
  assert.ok(fxCode.includes('DURATION = 7000'), 'مدة الألعاب النارية ~7 ثوانٍ');
  assert.ok(fxCode.includes('parts.length === 0'), 'الانتظار حتى موت الجسيمات');
});

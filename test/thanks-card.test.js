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

const FNS = ['thanksReducedMotion', 'renderThanksCard', 'thanksCollect', 'thanksShowCard', 'thanksPublish', 'thanksUnpublish', 'thanksPreviewPublished', '__thanksCardFor', '__thanksMaybeShow', 'thanksOpen', 'thanksReplay', 'thanksStopMotion', 'thanksClose', 'thanksStartFx'];
const CODE = 'let thanksPrefill = null;\nlet __thanksState = null;\nlet __thanksFx = null;\n' + FNS.map(n => extractFn(SRC, n)).join('\n') + `
;globalThis.__thanksApi = {
  renderThanksCard, thanksCollect, thanksShowCard, thanksPublish, thanksUnpublish, thanksPreviewPublished,
  __thanksCardFor, __thanksMaybeShow,
  thanksOpen, thanksReplay, thanksStopMotion, thanksClose, thanksStartFx, thanksReducedMotion,
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
    location: { hash: o.hash || '#/' },
    loadDB: () => o.db || DB,
    displayName: u => (u && u.name) || '',
    escapeHtml: s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    aliveMsgs: a => (Array.isArray(a) ? a : []).filter(m => m && !m.deleted),
    loadAdminMsgs: () => (Array.isArray(o.msgs) ? o.msgs : []),
    saveAdminMsgs: a => { o.msgs = JSON.parse(JSON.stringify(a)); },
    currentUser: () => o.user || null,
    alert: m => { (o.alerts = o.alerts || []).push(m); },
    renderApp: () => { o.renders = (o.renders || 0) + 1; },
    uid: () => 'm_' + (o.uidN = (o.uidN || 0) + 1),
    fmtDateOnly: s => String(s == null ? '' : s).slice(0, 10),
    requestAnimationFrame: cb => { rafs.push(cb); return rafs.length; },
    cancelAnimationFrame(){},
    setTimeout: () => 1,
    clearTimeout(){}
  };
  vm.createContext(ctx);
  vm.runInContext(CODE, ctx);
  ctx.__doc = doc;
  ctx.__rafs = rafs;
  ctx.__opts = o;
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

/* ============ النشر: البطاقة تظهر للمعلمة عند دخول حسابها ============ */

function formCtx(msgs, user){
  const ctx = buildCtx({ msgs: msgs || [], user: user || null });
  const doc = ctx.__doc;
  const sel = doc.createElement('select'); sel.id = 'thanksTeacher'; sel.value = '';
  const ta = doc.createElement('textarea'); ta.id = 'thanksMsg'; ta.value = '';
  const hint = doc.createElement('p'); hint.id = 'thanksHint';
  doc.body.appendChild(sel); doc.body.appendChild(ta); doc.body.appendChild(hint);
  ctx.__form = { sel, ta, hint };
  return ctx;
}

test('البوابة: إصدار جديد + تعطيل الشريط الأحمر والرنين لبطاقات الشكر', () => {
  const ver = SRC.match(/const __APP_VER = '([^']+)'/);
  assert.ok(ver && ver[1].includes('thanks-login'), 'بند الإصدار thanks-login');
  const banner = extractFn(SRC, 'renderAdminMsgAlerts');
  assert.ok(banner.includes("m.kind !== 'THANKS_CARD'"), 'الشريط الأحمر يستثني بطاقة الشكر فلا تكرر');
  const beep = extractFn(SRC, 'checkMsgBeep');
  assert.ok(beep.includes("m.kind !== 'THANKS_CARD'"), 'رنين الرسائل يستثني بطاقة الشكر');
});

test('البوابة: التعريض موصول عند الإقلاع وتسجيل الدخول ودورة مزامنة', () => {
  const login = extractFn(SRC, 'handleLogin');
  assert.ok(login.includes('__thanksMaybeShow()'), 'بعد نجاح الدخول تُفحص البطاقة');
  assert.ok(SRC.includes('window.__thanksTimer'), 'دورة فحص دورية للبطاقة بعد المزامنة');
  const bootIdx = SRC.indexOf('setupPasswordToggles();');
  const showIdx = SRC.indexOf('__thanksMaybeShow();', SRC.indexOf('window.__notifTimer'));
  assert.ok(showIdx > 0 && showIdx < bootIdx, 'فحص الإقلاع بعد الإشعارات وقبل الإعداد');
});

test('thanksPublish: اعتماد بطاقة يحفظها للمعلمة ويُشعر المدير', () => {
  const ctx = formCtx([{ id:'old1', kind:'THANKS_CARD', teacherId:'t1', teacherName:'شادية', text:'قديمة', createdAt:'2026-10-01T00:00:00.000Z', deleted:false }]);
  const o = ctx.__opts;
  o.user = { id:'a1', role:'ADMIN', name:'المديرة' };
  ctx.__form.sel.value = 't1';
  ctx.__form.ta.value = 'شكراً لجهودكِ الرائعة';
  ctx.__thanksApi.thanksPublish();
  assert.equal(o.msgs.length, 2, 'البطاقة القديمة (لا حذف) + الجديدة');
  const card = o.msgs.find(m => m.id !== 'old1');
  assert.equal(card.kind, 'THANKS_CARD', 'نوع البطاقة');
  assert.equal(card.teacherId, 't1', 'موجَّهة للمعلمة');
  assert.equal(card.text, 'شكراً لجهودكِ الرائعة', 'النص كما كُتب');
  assert.equal(card.read, false, 'غير مقروءة بعد');
  assert.equal(card.senderId, 'a1', 'مُرسِلها المدير');
  assert.equal(o.msgs.find(m => m.id === 'old1').deleted, true, 'البطاقة السابقة لذات المعلمة مُلغاة (أسافين لاصقة)');
  assert.ok(o.alerts && o.alerts[0].includes('ستظهر للمعلمة عند دخول حسابها'), 'تنبيه النجاح');
  assert.ok(o.renders >= 1, 'إعادة رسم الصفحة');
  assert.equal(ctx.__form.hint.textContent, '', 'لا خطأ');
  assert.equal(ctx.__thanksApi.getState(), null, 'النشر لا يفتح بطاقة المعاينة');
});

test('thanksPublish: بلا اختيار أو بلا نص أو معلمة مفقودة — لا حفظ ولا إشعار', () => {
  const ctx = formCtx([]);
  const o = ctx.__opts;
  o.user = { id:'a1', role:'ADMIN', name:'المديرة' };
  ctx.__thanksApi.thanksPublish();
  assert.equal(o.msgs.length, 0, 'لا نشر بلا اختيار');
  assert.ok(ctx.__form.hint.textContent.includes('اختاري المعلمة'), 'تلميح الاختيار');
  ctx.__form.sel.value = 't1';
  ctx.__thanksApi.thanksPublish();
  assert.equal(o.msgs.length, 0, 'لا نشر بلا نص');
  assert.ok(ctx.__form.hint.textContent.includes('اكتبي نص رسالة الشكر'), 'تلميح النص');
  ctx.__form.ta.value = 'شكراً';
  ctx.__form.sel.value = 'ghost';
  ctx.__thanksApi.thanksPublish();
  assert.equal(o.msgs.length, 0, 'لا نشر لمعلمة مفقودة');
  assert.equal(o.alerts, undefined, 'لا إشعار نجاح');
});

test('thanksUnpublish + المعاينة المنشورة: حذف لاصق وعرض من السجل', () => {
  const ctx = formCtx([{ id:'c1', kind:'THANKS_CARD', teacherId:'t2', teacherName:'نورة', text:'شكراً يا نورة', senderName:'المديرة', createdAt:'2026-10-10T00:00:00.000Z', deleted:false }]);
  const o = ctx.__opts;
  ctx.__thanksApi.thanksPreviewPublished('c1');
  let st = ctx.__thanksApi.getState();
  assert.ok(st, 'المعاينة تفتح البطاقة');
  assert.equal(st.name, 'نورة', 'اسم المعلمة');
  assert.ok(ctx.__doc.getElementById('thanksOverlay').innerHTML.includes('— المديرة'), 'توقيع المرسل في سطر الشكر');
  ctx.__thanksApi.thanksClose();
  ctx.__thanksApi.thanksUnpublish('c1');
  assert.equal(o.msgs[0].deleted, true, 'حذف لاصق');
  assert.equal(o.msgs[0].dismissed, true, 'مخفية من قوائم المعلمة');
  assert.ok(o.renders >= 1, 'إعادة رسم صفحة الشكر');
  ctx.__thanksApi.thanksUnpublish('ghost');
  assert.equal(o.msgs[0].deleted, true, 'معرّف غريب لا يؤثر');
});

test('renderThanksCard: قسم البطاقات المنشورة + زر النشر', () => {
  const ctx = buildCtx({ msgs: [
    { id:'c1', kind:'THANKS_CARD', teacherId:'t1', teacherName:'شادية', text:'شكر', createdAt:'2026-10-12T00:00:00.000Z', deleted:false },
    { id:'c2', kind:'THANKS_CARD', teacherId:'t2', teacherName:'نورة', text:'شكر2', createdAt:'2026-10-11T00:00:00.000Z', deleted:true }
  ] });
  const html = ctx.__thanksApi.renderThanksCard();
  assert.ok(html.includes('thanksPublish()'), 'زر الاعتماد والنشر');
  assert.ok(html.includes('✅ البطاقات المنشورة'), 'قسم المنشورات');
  assert.ok(html.includes('شادية'), 'البطاقة المنشورة ظاهرة');
  assert.ok(html.includes("thanksUnpublish('c1')"), 'زر إلغاء للبطاقة الحية');
  assert.ok(!html.includes("thanksUnpublish('c2')"), 'البطاقة الملغاة خارج القائمة');
  assert.ok(html.includes('thanksUnpublish(') && html.includes('thanksPreviewPublished('), 'أزرار المعاينة والإلغاء');
  assert.ok(html.includes('2026-10-12'), 'تاريخ النشر');
});

test('__thanksCardFor: أحدث بطاقة غير مقروءة لهذه المعلمة فقط', () => {
  const card = (id, teacherId, createdAt, over) => Object.assign({ id, kind:'THANKS_CARD', teacherId, teacherName:'م', text:'ن', createdAt, read:false, deleted:false }, over || {});
  const ctx = buildCtx({ msgs: [
    card('c1', 't1', '2026-10-01T00:00:00.000Z'),
    card('c2', 't1', '2026-10-05T00:00:00.000Z'),
    card('c3', 't2', '2026-10-09T00:00:00.000Z'),
    card('c4', 't1', '2026-10-07T00:00:00.000Z', { deleted:true }),
    card('c5', 't1', '2026-10-08T00:00:00.000Z', { read:true }),
    { id:'n1', teacherId:'t1', teacherName:'م', text:'رسالة عادية', createdAt:'2026-10-10T00:00:00.000Z', read:false }
  ] });
  const got = ctx.__thanksApi.__thanksCardFor({ id:'t1', role:'TEACHER', name:'شادية' });
  assert.ok(got, 'هناك بطاقة لها');
  assert.equal(got.id, 'c2', 'الأحدث غير المقروءة تُغني عن الأقدم');
  assert.equal(ctx.__thanksApi.__thanksCardFor({ id:'t3', role:'TEACHER', name:'غير' }), null, 'لا بطاقة لها');
  assert.equal(ctx.__thanksApi.__thanksCardFor({ id:'a1', role:'ADMIN', name:'المديرة' }), null, 'المدير لا بطاقات له');
  assert.equal(ctx.__thanksApi.__thanksCardFor(null), null, 'بلا مستخدم');
});

test('__thanksMaybeShow: يفتح البطاقة ويُثبت قراءتها فلا تتكرر', () => {
  const ctx = buildCtx({ msgs: [
    { id:'c1', kind:'THANKS_CARD', teacherId:'t1', teacherName:'شادية', text:'شكراً لكِ', senderName:'المديرة', createdAt:'2026-10-05T00:00:00.000Z', read:false, deleted:false },
    { id:'c0', kind:'THANKS_CARD', teacherId:'t1', teacherName:'شادية', text:'الأقدم', createdAt:'2026-10-01T00:00:00.000Z', read:false, deleted:false },
    { id:'c2', kind:'THANKS_CARD', teacherId:'t2', teacherName:'نورة', text:'لغيرها', createdAt:'2026-10-06T00:00:00.000Z', read:false, deleted:false },
    { id:'n1', teacherId:'t1', teacherName:'شادية', text:'رسالة عادية', createdAt:'2026-10-10T00:00:00.000Z', read:false, deleted:false }
  ], user: { id:'t1', role:'TEACHER', name:'شادية' } });
  const o = ctx.__opts;
  ctx.__thanksApi.__thanksMaybeShow();
  let st = ctx.__thanksApi.getState();
  assert.ok(st, 'البطاقة فُتحت عند الدخول');
  assert.equal(st.msg, 'شكراً لكِ', 'نص أحدث بطاقة');
  const ov = ctx.__doc.getElementById('thanksOverlay');
  assert.ok(ov.innerHTML.includes('— المديرة'), 'اسم المرسل في السطر');
  const c1 = o.msgs.find(m => m.id === 'c1');
  const c0 = o.msgs.find(m => m.id === 'c0');
  const c2 = o.msgs.find(m => m.id === 'c2');
  assert.equal(c1.read, true, 'قراءة مُثبتة');
  assert.ok(c1.seenBy && c1.seenBy.t1, 'اطلاع مسجَّل بمعرّف المعلمة');
  assert.equal(c1.dismissed, undefined, 'لم تُخفَ — القراءة هي منع التكرار');
  assert.equal(c0.read, true, 'البطاقة الأقدم تنازلت (لم تعد تُعرض)');
  assert.equal(c2.read, false, 'بطاقة معلمة أخرى لا تُمس');
  assert.equal(o.msgs.find(m => m.id === 'n1').read, false, 'الرسالة العادية لم تُقرأ');
  assert.equal(o.renders, undefined, 'الظهور لا يعيد رسم الصفحة');
  ctx.__thanksApi.thanksClose();
  ctx.__thanksApi.__thanksMaybeShow();
  assert.equal(ctx.__thanksApi.getState(), null, 'لا تُفتح مرة ثانية بعد القراءة');
});

test('__thanksMaybeShow: بطاقة جديدة تصل لاحقاً تظهر في الدورة نفسها', () => {
  const ctx = buildCtx({ msgs: [], user: { id:'t1', role:'TEACHER', name:'شادية' } });
  const o = ctx.__opts;
  ctx.__thanksApi.__thanksMaybeShow();
  assert.equal(ctx.__thanksApi.getState(), null, 'لا شيء بلا بطاقة');
  o.msgs.push({ id:'c9', kind:'THANKS_CARD', teacherId:'t1', teacherName:'شادية', text:'وصلت الآن', createdAt:'2026-10-20T00:00:00.000Z', read:false, deleted:false });
  ctx.__thanksApi.__thanksMaybeShow();
  const st = ctx.__thanksApi.getState();
  assert.ok(st, 'البطاقة المتأخرة ظهرت في الدورة');
  assert.equal(st.msg, 'وصلت الآن', 'نصها');
  ctx.__thanksApi.thanksClose();
  o.user = { id:'a1', role:'ADMIN', name:'المديرة' };
  ctx.__thanksApi.__thanksMaybeShow();
  assert.equal(ctx.__thanksApi.getState(), null, 'المدير لا تُفتح له البطاقة');
});

test('thanksOpen: سطر الشكر يحمل المرسل اختيارياً ويُهرَّب', () => {
  const ctx = buildCtx();
  ctx.__thanksApi.thanksOpen('شادية', 'شكراً');
  let html = ctx.__doc.getElementById('thanksOverlay').innerHTML;
  assert.ok(html.includes('مع خالص الشكر والتقدير</p>'), 'بلا مرسل — السطر نظيف');
  ctx.__thanksApi.thanksClose();
  ctx.__thanksApi.thanksOpen('شادية', 'شكراً', 'ناصر <script>');
  html = ctx.__doc.getElementById('thanksOverlay').innerHTML;
  assert.ok(html.includes('مع خالص الشكر والتقدير — ناصر &lt;script&gt;'), 'المرسل مهرَّب في السطر');
});

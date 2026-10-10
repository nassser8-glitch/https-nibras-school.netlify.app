'use strict';
/* الخدمات الست في شريط البنات: عند توفرها تمر الترجمة ومواقيت الصلاة عبر خادمنا
 * (نفس الأصل فلا CORS) وتعرض النتيجة فعلياً، ومع تعطل المسار تسقط لخدمة مباشرة.
 * نحمّل المحل الحقيقي (public/toolbar.js) في بيئة معزولة وندفع له استجابات وهمية.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'public', 'toolbar.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

function makeEl(id) {
  return {
    id: id || '', innerHTML: '', className: '', isConnected: true, children: [], style: {},
    _l: {},
    appendChild(c) { this.children.push(c); return c; },
    addEventListener(t, fn) { (this._l[t] = this._l[t] || []).push(fn); },
    removeEventListener() {},
    setAttribute() {}, removeAttribute() {}, getAttribute(k) { return null; },
    querySelector() { return null; },
  };
}
function makeStore() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
  };
}
function loadToolbar(opts) {
  opts = opts || {};
  const store = makeStore();
  const doc = { readyState: 'complete', body: makeEl('body'), createElement: () => makeEl(''),
    addEventListener() {}, getElementById: () => null };
  const fetchCalls = [];
  const fetchImpl = opts.fetch || (() => Promise.reject(new Error('offline')));
  const ctx = {
    window: {}, document: doc, localStorage: store, navigator: {},
    Intl, Date, Math, JSON, Object, Array, String, Number, isFinite, parseInt, parseFloat, encodeURIComponent,
    setTimeout() {}, setInterval() {}, clearTimeout() {}, clearInterval() {},
    console, fetch: function (u) { fetchCalls.push(String(u)); return fetchImpl(String(u)); }
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: 'toolbar.js' });
  return { api: ctx.window.__tb, store, fetchCalls, doc, ctx };
}
const ok = (body, status) => ({ status: status == null ? 200 : status, json: async () => body });
const ko = () => Promise.reject(new Error('network down'));
/* fetchWeather/fetchPrayer لا ترجعان وعودهما؛ ننتظر نفاد الطور الحالي حتى تكتمل السلاسل. */
const tick = () => new Promise(r => setTimeout(r, 10));
/* تعرض الساعة أرقاماً عربية: نبسّطها قبل المطابقة. */
const normDigits = (s) => String(s).replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));

test('خدمة 1·الطقس: تستخدم open-meteo وتُرجع قراءة حقيقية', async () => {
  const t = loadToolbar({ fetch: u => (u.includes('open-meteo')
    ? Promise.resolve(ok({ current: { temperature_2m: 19, weather_code: 2, wind_speed_10m: 6 }, daily: { temperature_2m_min: [12], temperature_2m_max: [21] } }))
    : ko()) });
  t.api.fetchWeather(makeEl('tbBody'));
  await tick();
  const c = t.api.lsGet('weather', null);
  assert.ok(c && c.t === 19, 'قراءة الحرارة مأخوذة من الاستجابة');
  assert.ok(c && c.code === 2, 'رمز الحالة مأخوذ');
  const urls = t.fetchCalls.map(u => u.split('?')[0]);
  assert.ok(urls.every(u => u.includes('open-meteo')), 'يتصل بـ open-meteo فقط');
});

test('خدمة 2·الساعة: مناطق زمنية معروفة تُعرض بالتنسيق المحلي', () => {
  const t = loadToolbar();
  for (const tz of ['Asia/Amman', 'Asia/Riyadh', 'America/New_York']) {
    const s = t.ctx.window.__tbFmtZone(tz);
    assert.match(normDigits(s), /^\d{2}:\d{2}$/, 'تنسيق HH:MM لـ ' + tz + ' (' + s + ')');
  }
});

test('خدمة 3·التقويم: تحويل هجري سليم ومميز لكل يوم', () => {
  const t = loadToolbar();
  const h = t.api.hijri(2026, 9, 4);
  assert.ok(h && h.year === 1448 && h.day >= 1 && h.day <= 30, 'تحويل هجري صحيح');
  const seen = new Set();
  for (let m = 0; m < 12; m++) {
    const days = new Date(2026, m + 1, 0).getDate();
    for (let d = 1; d <= days; d++) {
      const x = t.api.hijri(2026, m, d);
      assert.ok(x, 'كل يوم يتحوّل');
      seen.add(x.year + ':' + x.month + ':' + x.day);
    }
  }
  assert.equal(seen.size, 365, 'أيام هجرية مميزة');
});

test('خدمة 4·الحاسبة: أولويات صحيحة ورفض المدخلات الغريبة', () => {
  const t = loadToolbar();
  assert.equal(t.api.calcEval('2+3*4'), 14);
  assert.equal(t.api.calcEval('(2+3)*4'), 20);
  assert.equal(t.api.calcEval('2^3^2'), 512);
  assert.equal(t.api.calcEval('-2^2'), -4);
  assert.ok(Number.isNaN(t.api.calcEval('2+')) && Number.isNaN(t.api.calcEval('abc')), 'لا يعيد رقماً عشوائياً');
});

test('خدمة 5·الترجمة: عبر خادمنا أولاً ثم MyMemory بديلاً', async () => {
  const t = loadToolbar({
    fetch: u => (u.indexOf('/api/translate') === 0
      ? Promise.resolve(ok({ ok: true, text: 'صباح الخير' }))
      : ko())
  });
  const out = await t.api.trRemote('good morning', 'en', 'ar');
  assert.equal(out, 'صباح الخير');
  assert.ok(t.fetchCalls[0].indexOf('/api/translate?q=') === 0, 'يتصل بتأويلنا أولاً');
  assert.ok(t.fetchCalls.every(u => u.indexOf('mymemory') === -1), 'لا يمر بخدمة أجنبية مباشرة ما دام وسيطنا يعمل');
});

test('خدمة 5·الترجمة: السقوط إلى MyMemory عندما يفشل الوسيط', async () => {
  const t = loadToolbar({
    fetch: u => (u.indexOf('/api/translate') === 0
      ? ko()
      : Promise.resolve(ok({ responseData: { translatedText: 'مرحبا' } })))
  });
  const out = await t.api.trRemote('hello', 'en', 'ar');
  assert.equal(out, 'مرحبا');
  assert.ok(t.fetchCalls[1] && t.fetchCalls[1].indexOf('mymemory') > -1, 'طلب خارجي احتياطي عند فشل الوسيط');
});

test('خدمة 6·الصلاة: عبر خادمنا أولاً وتُحفظ الأوقات الملحوقة', async () => {
  const day = new Date();
  const key = day.getFullYear() + '-' + (day.getMonth() + 1) + '-' + day.getDate();
  const t = loadToolbar({
    fetch: u => (u.indexOf('/api/prayer?') === 0
      ? Promise.resolve(ok({ ok: true, day: '2026-10-10', tz: 'Asia/Amman', t: {
          fajr: Date.now() - 3600e3, sunrise: Date.now() - 1800e3,
          dhuhr: Date.now() + 3600e3, asr: Date.now() + 7200e3,
          maghrib: Date.now() + 10800e3, isha: Date.now() + 14400e3 } }))
      : ko())
  });
  t.api.fetchPrayer(makeEl('tbBody'));
  await tick();
  const c = t.api.lsGet('prayer', null);
  assert.ok(c && c.day === key, 'محفوظة ليوم اليوم');
  assert.ok(c && typeof c.t.fajr === 'number', 'أوقاتها لحظات زمنية مطلقة');
  assert.ok(t.fetchCalls[0].indexOf('/api/prayer?lat=') === 0, 'اتصال بوسيطنا');
  assert.ok(t.fetchCalls.every(u => u.indexOf('aladhan') === -1), 'لا دفقة أجنبية مع وسيط يعمل');
  const box = makeEl('tbBody');
  t.api.prayerRender(box);
  assert.ok(/tb-next/.test(box.innerHTML), 'يُبزّز الصلاة القادمة');
});

test('خدمة 6·الصلاة: سقوط إلى aladhan عندما يتعطل الوسيط', async () => {
  const t = loadToolbar({
    fetch: u => (u.indexOf('/api/prayer?') === 0
      ? ko()
      : Promise.resolve(ok({ data: { timings: { Fajr: '05:12 (EET)', Dhuhr: '12:30 (EET)', Isha: '19:45 (EET)' }, meta: { timezone: 'Asia/Amman' } } })))
  });
  t.api.fetchPrayer(makeEl('tbBody'));
  await tick();
  const c = t.api.lsGet('prayer', null);
  assert.ok(c && c.t.fajr, 'أوقات من الخدمة المباشرة');
  assert.ok(t.fetchCalls.some(u => u.indexOf('aladhan') > -1), 'طلب مباشر للاحتياط');
});

test('server: وسيطا الترجمة والصلاة موجودان ومحميان', () => {
  assert.ok(/app\.get\('\/api\/translate',\s*requireAuth/.test(SERVER), '/api/translate الوسيط مصادق');
  assert.ok(/app\.get\('\/api\/prayer',\s*requireAuth/.test(SERVER), '/api/prayer الوسيط مصادق');
  assert.ok(/bad_langs/.test(SERVER), 'تحقق من صحة اللغات');
  assert.ok(/bad_coords/.test(SERVER), 'تحقق من صحة الإحداثيات');
  assert.ok(SERVER.includes('timezonestring=Asia/Amman'), 'وسيط الصلاة يستخدم منطقة عمّان');
  assert.ok(SERVER.includes(") || 'Asia/Amman'"), 'متابعة عمّان افتراضياً عند غيابها في الرد');
});
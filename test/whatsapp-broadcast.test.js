'use strict';
/* =============================================================================
 * حارس «الرسائل الجماعية عبر واتساب»
 * -----------------------------------------------------------------------------
 * يثبّت: تحديد المستلمات (Exclusions)، العدّادات، الاستبدال لكل مستلمة،
 * واتساب اليدوي (wa.me)، الإرسال الرسمي (Cloud API) بلا اتصال شبكة حقيقي،
 * منع التكرار، الصلاحيات، إعداد البيئة بلا كشف أسرار، وربط الخادم والواجهة.
 * ========================================================================== */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const wa = require(path.join(ROOT, 'whatsapp.js'));
const SERVER = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const SRC = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

const cls = (id) => (id === 'c1' ? 'أول - 1' : id === 'c2' ? 'ثاني - 2' : id || '');
const students = [
  { id: 's1', fullName: 'ريم', classId: 'c1', active: true, guardianPhone: '0501111111', waConsent: true },
  { id: 's2', fullName: 'سارة', classId: 'c1', active: true, guardianPhone: '0502222222', waConsent: true },
  { id: 's3', fullName: 'هند', classId: 'c1', active: true, guardianPhone: '', waConsent: true },          // بلا رقم
  { id: 's4', fullName: 'لمى', classId: 'c2', active: true, guardianPhone: '0504444444', waConsent: false }, // بلا موافقة
  { id: 's5', fullName: 'نور', classId: 'c2', active: true, guardianPhone: '0501111111', waConsent: true },  // رقم مكرّر مع s1
  { id: 's6', fullName: 'مسحوبة', classId: 'c1', active: false, guardianPhone: '0506666666', waConsent: true }, // غير نشِطة
  { id: 's7', fullName: 'جنى', classId: 'c2', active: true, guardianPhone: '123', waConsent: true },          // رقم غير صالح
];
const attendance = [
  { studentId: 's1', date: '2026-10-15', status: 'ABSENT' },
  { studentId: 's2', date: '2026-10-15', status: 'LATE' },     // متأخرة = حاضرة
  { studentId: 's3', date: '2026-10-15', status: 'PRESENT' },
  { studentId: 's4', date: '2026-10-15', status: 'ABSENT' },
];

test('1) تطبيع الرقم وقناع العرض', () => {
  assert.equal(wa.normalizePhone('0501111111'), '966501111111');
  assert.equal(wa.normalizePhone('501111111'), '966501111111');
  assert.equal(wa.normalizePhone('00966501111111'), '966501111111');
  assert.equal(wa.normalizePhone('+966 50 111 1111'), '966501111111');
  assert.equal(wa.normalizePhone(''), '');
  assert.ok(wa.isValidPhone('966501111111'));
  assert.ok(!wa.isValidPhone('123'));
  assert.equal(wa.maskPhone('966501111111'), '966••••••111');
});

test('2) الاستثناءات: بلا رقم/غير صالح/بلا موافقة/غير نشِطة + العدّادات', () => {
  const r = wa.resolveRecipients({ students, attendance, target: 'all', classNameOf: cls });
  // النطاق النشط فقط (s6 مستبعدة)
  assert.equal(r.counts.totalInScope, 6);
  // s1,s2 صالحتان+موافقة | s5 مكرّرة | s3 بلا رقم | s7 رقم غير صالح | s4 بلا موافقة
  assert.equal(r.counts.withValidPhone, 4);
  assert.equal(r.counts.invalidOrMissing, 2); // s3 (بلا رقم) + s7 (غير صالح)
  assert.equal(r.counts.noConsent, 1);        // s4
  assert.equal(r.counts.duplicates, 1);       // s5
  assert.equal(r.counts.finalCount, 2);       // s1 + s2
  const inc = r.list.filter(x => x.included).map(x => x.id).sort();
  assert.deepEqual(inc, ['s1', 's2']);
  assert.equal(r.list.find(x => x.id === 's5').reason, 'duplicate');
});

test('3) الغائبات: ABSENT فقط والمتأخرة حاضرة + تحذير بلا بيانات', () => {
  const r = wa.resolveRecipients({ students, attendance, target: 'absent', date: '2026-10-15', classNameOf: cls });
  const inc = r.list.filter(x => x.included).map(x => x.id).sort();
  assert.deepEqual(inc, ['s1']); // s4 غائبة لكن بلا موافقة — مستبعدة
  assert.ok(!r.list.some(x => x.id === 's2' && x.included), 'المتأخرة يجب ألّا تُعدّ غائبة');
  const none = wa.resolveRecipients({ students, attendance, target: 'absent', date: '2020-01-01', classNameOf: cls });
  assert.equal(none.counts.finalCount, 0);
  assert.ok(none.warn && none.warn.length > 3, 'لا بد من تحذير عند غياب بيانات الحضور');
});

test('4) نطاقا الفصل والاختيار اليدوي', () => {
  const c = wa.resolveRecipients({ students, attendance, target: 'class', classId: 'c1', classNameOf: cls });
  assert.ok(c.list.every(x => x.classId === 'c1'));
  const m = wa.resolveRecipients({ students, attendance, target: 'manual', ids: ['s4'], classNameOf: cls });
  assert.equal(m.list.length, 1);
  assert.equal(m.list[0].included, false); // s4 بلا موافقة
  const empty = wa.resolveRecipients({ students, attendance, target: 'manual', ids: [], classNameOf: cls });
  assert.ok(empty.warn, 'يجب تحذير عند عدم اختيار أي طالبة');
});

test('5) استبدال المتغيرات لكل مستلمة', () => {
  assert.equal(wa.renderTemplate('مرحباً {studentName} في {className} — {date}', { studentName: 'ريم', className: 'أول - 1', date: '2026-10-15' }),
    'مرحباً ريم في أول - 1 — 2026-10-15');
  assert.equal(wa.renderTemplate('{studentName}، {studentName}', { studentName: 'نور' }), 'نور، نور');
  const r = wa.resolveRecipients({ students, attendance, target: 'all', classNameOf: cls });
  const s2 = r.list.find(x => x.id === 's2');
  assert.equal(wa.renderTemplate('{studentName}', { studentName: s2.name }), 'سارة');
});

test('6) رابط wa.me والتحقق من الرسالة', () => {
  const url = wa.waMeLink('0501111111', 'مرحباً ريم');
  assert.ok(url.startsWith('https://wa.me/966501111111?text='));
  assert.ok(!url.includes('+'));
  assert.ok(url.includes(encodeURIComponent('مرحباً ريم')));
  assert.equal(wa.waMeLink('123', 'x'), '');
  assert.equal(wa.validateMessage(''), 'empty_message');
  assert.equal(wa.validateMessage('   '), 'empty_message');
  assert.equal(wa.validateMessage('x'.repeat(5000)), 'message_too_long');
  assert.equal(wa.validateMessage('نص'), '');
});

test('7) دمج الحالات رتيب — لا يتراجع من مقبولة إلى مفتوحة', () => {
  assert.equal(wa.mergeStatus('opened', 'accepted'), 'accepted');
  assert.equal(wa.mergeStatus('accepted', 'opened'), 'accepted');
  assert.equal(wa.mergeStatus('accepted', 'delivered'), 'delivered');
  assert.equal(wa.mergeStatus('read', 'failed'), 'read');
  assert.equal(wa.mergeStatus('pending', 'opened'), 'opened');
  assert.deepEqual(wa.MANUAL_STATUSES, ['opened', 'confirmed_sent', 'failed']);
});

test('8) الصلاحيات: الأدوار المنصوصة وعزل القسم', () => {
  assert.ok(wa.canBroadcast({ role: 'ADMIN' }, 'GIRLS'));
  assert.ok(wa.canBroadcast({ role: 'AGENT', school: 'GIRLS' }, 'GIRLS'));
  assert.ok(wa.canBroadcast({ role: 'SCHOOL_AGENT', school: 'GIRLS' }, 'GIRLS'));
  assert.ok(wa.canBroadcast({ role: 'COUNSELOR', school: 'GIRLS' }, 'GIRLS'));
  assert.ok(!wa.canBroadcast({ role: 'TEACHER', school: 'GIRLS' }, 'GIRLS'));
  assert.ok(!wa.canBroadcast({ role: 'STUDENT', school: 'GIRLS' }, 'GIRLS'));
  assert.ok(!wa.canBroadcast({ role: 'AGENT', school: 'BOYS' }, 'GIRLS'));
  assert.ok(!wa.canBroadcast(null, 'GIRLS'));
});

test('9) إعداد البيئة بلا كشف أسرار', () => {
  const env = { WHATSAPP_ACCESS_TOKEN: 'SECRET_TOKEN', WHATSAPP_PHONE_NUMBER_ID: '999', WHATSAPP_API_VERSION: 'v20.0' };
  const cfg = wa.configFromEnv(n => env[n]);
  assert.equal(cfg.configured, true);
  assert.equal(cfg.apiVersion, 'v20.0');
  const pub = wa.publicConfig(cfg);
  assert.equal(pub.configured, true);
  assert.equal(pub.phoneNumberIdSet, true);
  const dump = JSON.stringify(pub);
  assert.ok(!dump.includes('SECRET_TOKEN'), 'لا يُسرَّب التوكن للواجهة');
  assert.ok(!dump.includes('999'), 'لا يُسرَّب معرف الرقم الكامل');
  const empty = wa.publicConfig(wa.configFromEnv(n => undefined));
  assert.equal(empty.configured, false);
  assert.deepEqual(empty.requirements, ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID']);
});

test('10) الإرسال الرسمي: غير مهيّأ / نجاح / فشل — بلا شبكة حقيقية', async () => {
  const notCfg = await wa.sendCloudMessage('0501111111', 'x', wa.configFromEnv(n => undefined));
  assert.equal(notCfg.ok, false);
  assert.equal(notCfg.error, 'not_configured');

  const calls = [];
  const okFetch = async (url, opt) => {
    calls.push({ url, opt });
    return { status: 200, json: async () => ({ messages: [{ id: 'wamid.TEST', message_status: 'accepted' }] }) };
  };
  const cfg = { accessToken: 'SECRET_TOKEN', phoneNumberId: 'PID', apiVersion: 'v21.0' };
  const ok = await wa.sendCloudMessage('0501111111', 'مرحباً', cfg, okFetch);
  assert.equal(ok.ok, true);
  assert.equal(ok.providerId, 'wamid.TEST');
  assert.equal(calls[0].url, 'https://graph.facebook.com/v21.0/PID/messages');
  assert.equal(calls[0].opt.headers.Authorization, 'Bearer SECRET_TOKEN');
  const body = JSON.parse(calls[0].opt.body);
  assert.equal(body.to, '966501111111');
  assert.equal(body.text.body, 'مرحباً');

  const failFetch = async () => ({ status: 400, json: async () => ({ error: { message: 'Invalid parameter' } }) });
  const bad = await wa.sendCloudMessage('0501111111', 'x', cfg, failFetch);
  assert.equal(bad.ok, false);
  assert.ok(bad.error.includes('Invalid parameter'));
  assert.ok(!bad.error.includes('SECRET_TOKEN'));

  const netFetch = async () => { throw new Error('network down'); };
  const net = await wa.sendCloudMessage('0501111111', 'x', cfg, netFetch);
  assert.equal(net.ok, false);
  assert.equal(net.error, 'network down');
});

test('11) الخادم: المسارات + فرض الصلاحية + الإعداد من البيئة', () => {
  assert.ok(SERVER.includes("require('./whatsapp')"), 'الخادم لا يستورد خدمة واتساب');
  for (const route of [
    "app.get('/api/wa/config'",
    "app.post('/api/wa/campaign'",
    "app.post('/api/wa/send'",
    "app.post('/api/wa/status'",
    "app.post('/api/wa/consent'",
    "app.post('/api/wa/cancel'",
    "app.get('/api/wa/campaign/:id'",
    "app.get('/api/wa/campaigns'",
    "app.get('/api/wa/webhook'",
    "app.post('/api/wa/webhook'",
  ]) assert.ok(SERVER.includes(route), 'مسار مفقود: ' + route);
  assert.ok(SERVER.includes('wa.canBroadcast(req.session, school)'), 'لا فرض صلاحية على الخادم');
  assert.ok(SERVER.includes("wa.configFromEnv(n => envOrSecret(n, ''))"), 'الإعداد لا يأتي من البيئة');
  assert.ok(SERVER.includes('wa.resolveRecipients('), 'الخادم لا يحدّد المستلمات بنفسه');
  assert.ok(SERVER.includes('wa.publicConfig(waConfig())'), 'لا يكشف الإعداد العام');
  assert.ok(!SERVER.includes('app.use(express.static') || SERVER.indexOf("app.post('/api/wa/send'") < SERVER.indexOf('app.use(express.static'), 'المسارات قبل الملفات الثابتة');
});

test('12) الواجهة: الوصول + الموافقة + الصفحة + بلا أسرار', () => {
  assert.ok(SRC.includes("href:'#/broadcast', key:'broadcast'"), 'لا عنصر تنقّل للخدمة');
  assert.ok(SRC.includes('function canBroadcastWa('), 'دالة الصلاحية مفقودة');
  assert.ok(SRC.includes('function studentWaConsent('), 'دالة الموافقة مفقودة');
  assert.ok(SRC.includes('waConsent'), 'لا حقل موافقة في البيانات');
  assert.ok(SRC.includes("canBroadcastWa(user)) pageHtml = renderBroadcast()"), 'الصفحة غير مربوطة بالتوجيه');
  assert.ok(SRC.includes('function renderBroadcast('), 'دالة الصفحة مفقودة');
  assert.ok(SRC.includes('__waResolve('), 'لا تحديد مستلمات في الواجهة');
  assert.ok(SRC.includes('إجمالي النطاق') && SRC.includes('العدد النهائي للإرسال'), 'العدّادات المطلوبة ناقصة');
  assert.ok(SRC.includes('تأكيد إنشاء الحملة'), 'لا تأكيد قبل الإنشاء');
  assert.ok(SRC.includes('تأكيد الإرسال الفعلي'), 'لا تأكيد قبل الإرسال');
  assert.ok(SRC.includes('setStudentWaConsent'), 'لا توثيق موافقة (فردي/جماعي)');
  assert.ok(SRC.includes('__waSetConsentServer') && SRC.includes("'/consent'"), 'الموافقة لا تُكتب على الخادم مباشرة');
  assert.ok(SRC.includes('function __waApplyConsentLocally('), 'لا تحديث محلي متفائل للموافقة');
  assert.ok(SRC.includes('توثيق موافقة الصالحات'), 'لا زر توثيق جماعي واضح');
  assert.ok(!SRC.includes('WHATSAPP_ACCESS_TOKEN'), 'لا يجوز ذكر اسم مفتاح API في الواجهة');
  assert.ok(!/accessToken\s*[:=]\s*['"][A-Za-z0-9]{6,}/.test(SRC), 'لا مفاتيح مكتوبة في الواجهة');
});

test('13) رفع الإصدارات بعد الإضافة', () => {
  const v = SRC.match(/const __APP_VER = '([^']+)'/);
  assert.ok(v && v[1].includes('guardian-editor'), 'الإصدار لا يعكس السجل');
  assert.ok(v[1].includes('wa-broadcast'), 'الإصدار لا يحمل وسم خدمة الواتساب الجماعي');
  assert.ok(v[1].includes('wa-consent'), 'الإصدار لا يحمل وسم توثيق الموافقة');
  assert.ok(v[1].includes('save-persist'), 'الإصدار لا يحمل وسم إصلاح موثوقية الحفظ');
  const sw = fs.readFileSync(path.join(ROOT, 'public', 'sw.js'), 'utf8');
  const n = Number((sw.match(/nibras-v(\d+)/) || [])[1]);
  assert.ok(n >= 139, 'CACHE_NAME لم يُرفَع');
  assert.ok(SRC.includes('sw.js?v=118'), 'نسخة service worker لم تُرفَع');
});

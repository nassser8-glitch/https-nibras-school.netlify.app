'use strict';
/* =============================================================================
 * صلاحيات «تهاني» (إدارية بنات) في إرسال واتساب الفردي
 * -----------------------------------------------------------------------------
 * المطلوب: ترسل رسالة واتساب فردية بنفس الطريقة المتاحة للوكيل والموجهة —
 * أي زر ولي الأمر الفردي (wa.me) في قائمة الطلاب وملف الطالبة — دون تغيير دورها
 * وبلا صلاحيات إدارة المستخدمين/المعلمين وبلا مساس بالإرسال الجماعي.
 *
 * ما كُشف عند الفحص:
 *  - بوابة الزر الفردي هي isAdminCadre، ودورها ADMINISTRATIVE داخلها منذ 66f9b08،
 *    فكان الزر متاحاً لها في الكود.
 *  - الثغرة الحقيقية: زر «توثيق الموافقة» في ملف الطالبة يظهر لمن هم isAdminCadre،
 *    لكن الدالة behindه كانت ترفض غير canBroadcastWa — فيظهر الزر ولا يفعل شيئاً
 *    لتهاني. عُلّق ببوابة واحدة canWaConsent في الواجهة، وضُيف استثناؤها المعرّفي
 *    على الخادم في /api/wa/consent (isGuardianPhoneEditor).
 *  - إنشاء/إرسال الحملات الجماعية بقي على canBroadcast دون تغيير.
 * ========================================================================== */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const SW = fs.readFileSync(path.join(ROOT, 'public', 'sw.js'), 'utf8');

const TEHANI = 'id_61e90132bc11ff7b';

function extractFns(names, extra) {
  const parts = [];
  for (const name of [].concat(names)) {
    const token = 'function ' + name + '(';
    const idx = SRC.indexOf(token);
    assert.ok(idx >= 0, 'لم أجد الدالة ' + name);
    let i = SRC.indexOf('{', idx), depth = 0, end = -1;
    for (; i < SRC.length; i++) {
      const ch = SRC[i];
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    assert.ok(end > 0, 'لم يُغلق جسم ' + name);
    parts.push(SRC.slice(idx, end));
  }
  if (extra) parts.push(extra);
  return parts.join('\n');
}
const GUARDIAN_IDS = SRC.match(/const GUARDIAN_PHONE_EDITOR_IDS = \[[^\]]*\];/)[0];

// يبني سياقاً حقيقياً من دوال التطبيق نفسه (لا نسخة مبسّطة)
function ctxFor(user, student) {
  const ctx = {
    __U: user, __S: student, String, encodeURIComponent, console,
    escapeHtml: v => String(v == null ? '' : v),
    window: { open: u => { ctx.__opened.push(u); } },
    alert: () => {},
    __opened: [],
  };
  const code = [
    GUARDIAN_IDS,
    extractFns(['isManager', 'isAdminRole', 'isAdminCadre', 'studentWaConsent', 'canBroadcastWa', 'canWaConsent']),
    'function currentUser(){ return __U; }',
    'function studentById(){ return __S; }',
    extractFns(['__waIntl', 'studentPhone', '__waGuardianEnabled', 'studentPhoneHTML', '__waGuardianOpen', 'setStudentWaConsent']),
  ].join('\n');
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return ctx;
}

const TEHANI_U = { id: TEHANI, role: 'ADMINISTRATIVE', name: 'تهاني أحمد', school: 'GIRLS' };
const AGENT_U = { id: 'id_agent', role: 'AGENT' };
const COUNSELOR_U = { id: 'id_counselor', role: 'COUNSELOR' };
const OTHER_ADMIN_U = { id: 'id_other_admin', role: 'ADMINISTRATIVE' };
const TEACHER_U = { id: 'id_teacher', role: 'TEACHER' };
const STUDENT_U = { id: 'id_student', role: 'STUDENT' };
const STU = { id: 's1', fullName: 'ملاذ عبدالله', guardianPhone: '966551234567' };

// ------------------------------------------------ 1) تحديد الحساب
test('1) حساب تهاني: المعرّف الثابت والقسم ودورها الإداري', () => {
  assert.equal(TEHANI, 'id_61e90132bc11ff7b', 'المعرّف الثابت متغيّر');
  assert.ok(SERVER.includes("GIRLS: ['" + TEHANI + "']"), 'لا إسناد قسم لها في الخادم');
  assert.ok(SERVER.includes('تهاني'), 'لا تعريف بالحساب في الخادم');
  assert.ok(GUARDIAN_IDS.includes(TEHANI), 'غير داخلة في استثناء الخادم');
  assert.equal((GUARDIAN_IDS.match(/id_/g) || []).length, 1, 'الاستثناء يجب ألا يشمل حساباً آخر');
  // دورها ما زال ADMINISTRATIVE — لم يُرفع إلى AGENT/COUNSELOR
  assert.equal(TEHANI_U.role, 'ADMINISTRATIVE');
  assert.equal(ctxFor(TEHANI_U).isAdminCadre(TEHANI_U), true, 'ضمن الكادر الإداري');
});

// ------------------------------------------------ 2) زر الواتساب الفردي
test('2) الزر الفردي يظهر لتهاني في قائمة الطلاب وفي ملف الطالبة', () => {
  const t = ctxFor(TEHANI_U, STU);
  assert.ok(t.studentPhoneHTML(STU).includes('__waGuardianOpen'), 'لا زر في قائمة الطلاب لتهاني');
  assert.equal(t.__waGuardianEnabled(STU), true, 'بوابة الفتح مغلقة لتهاني');

  const a = ctxFor(AGENT_U, STU), c = ctxFor(COUNSELOR_U, STU);
  assert.ok(a.studentPhoneHTML(STU).includes('__waGuardianOpen'), 'لا زر للوكيل');
  assert.equal(c.__waGuardianEnabled(STU), true, 'بوابة الفتح مغلقة للموجهة');
  // نفس الوضعية نفسها للوكيل/الموجهة — لا فرق في الشروط
  assert.equal(a.__waGuardianEnabled(STU), t.__waGuardianEnabled(STU), 'الشرط يختلف عن الوكيل');
  assert.equal(c.__waGuardianEnabled(STU), t.__waGuardianEnabled(STU), 'الشرط يختلف عن الموجهة');

  // ولا زر بلا رقم، ولا زر للمعلمة/الطالبة
  assert.equal(t.__waGuardianEnabled({ id: 'x' }), false, 'بلا رقم محفوظ = بلا زر');
  assert.equal(ctxFor(TEACHER_U, STU).__waGuardianEnabled(STU), false, 'المعلمة لا ترى الزر');
  assert.equal(ctxFor(STUDENT_U, STU).__waGuardianEnabled(STU), false, 'الطالبة لا ترى الزر');
});

// ------------------------------------------------ 3) فتح محادثة بالرقم الصحيح
test('3) تجهيز رسالة فردية وفتح wa.me برقم الطالبة نفسه، يدوياً وبلا إرسال', () => {
  const ctx = ctxFor(TEHANI_U, STU);
  ctx.__waGuardianOpen('s1');
  const opened = ctx.__opened;
  assert.equal(opened.length, 1, 'لم تُفتح محادثة');
  assert.ok(opened[0].startsWith('https://wa.me/966551234567?text='), 'الرقم غير صحيح: ' + opened[0]);
  const text = decodeURIComponent(opened[0].split('?text=')[1]);
  assert.ok(text.includes('ملاذ عبدالله'), 'لا اسم الطالبة في المسودة');
  assert.ok(text.length > 20, 'المسودة فارغة');

  // الرقم بالصيغة المحلية يُوحَّد إلى 966… قبل الفتح
  const local = ctxFor(TEHANI_U, { id: 's2', fullName: 'ب', guardianPhone: '0551112233' });
  local.__waGuardianOpen('s2');
  assert.ok(local.__opened[0].startsWith('https://wa.me/966551112233?text='), 'لم يُوحَّد الرقم المحلي');

  // لا إرسال تلقائي ولا شبكة
  const body = extractFns('__waGuardianOpen');
  assert.ok(!body.includes('fetch(') && !body.includes('XMLHttpRequest'), 'لا طلب شبكة');
  assert.ok(body.includes("window.open(url, '_blank', 'noopener')"), 'لا فتح المحادثة');

  // باب سلامة ثانٍ داخل الفتح
  assert.ok(body.includes('if(!__waGuardianEnabled(s)) return;'), 'لا بوابة داخل الفتح');
});

// ------------------------------------------------ 4) توثيق الموافقة (الثغرة المُصلَحة)
test('4) زر الموافقة في ملف الطالبة يعمل لتهاني (لا زر بلا فعل)', () => {
  const t = ctxFor(TEHANI_U, STU);
  assert.equal(t.canWaConsent(TEHANI_U), true, 'استثناء تهاني غير مفعّل');
  assert.equal(t.canWaConsent(AGENT_U), true, 'الوكيل يفقد الموافقة');
  assert.equal(t.canWaConsent(COUNSELOR_U), true, 'الموجهة تفقد الموافقة');
  assert.equal(t.canWaConsent(OTHER_ADMIN_U), false, 'إدارية أخرى لا تُصرّح');
  assert.equal(t.canWaConsent(TEACHER_U), false, 'المعلمة مرفوضة');
  assert.equal(t.canWaConsent(STUDENT_U), false, 'الطالبة مرفوضة');
  assert.equal(t.canWaConsent(null), false);

  // البوابة واحدة في العرض وفي الدالة: لا زر يظهر ولا يفعل شيئاً
  assert.ok(extractFns('setStudentWaConsent').includes('canWaConsent(currentUser())'), 'دالة الموافقة بوابتها غير canWaConsent');
  const modal = SRC.slice(SRC.indexOf('function showStudentPoints('), SRC.indexOf('/* ============ المفكرة والتذكير'));
  assert.ok(modal.includes('${canWaConsent(currentUser()) ? `'), 'زر الموافقة في الملف ببوابة أخرى');
  assert.ok(modal.includes('waToggleStudentConsent('), 'لا زر توثيق في ملف الطالبة');
});

// ------------------------------------------------ 5) الخادم: استثناء محدود + بلا مساس بالحملات
test('5) الخادم: الموافقة باستثناء تهاني، والحملات بقاها canBroadcast', () => {
  assert.ok(SERVER.includes("app.post('/api/wa/consent'"), 'لا مسار موافقة');
  const consent = SERVER.slice(SERVER.indexOf("app.post('/api/wa/consent'"), SERVER.indexOf("app.post('/api/wa/cancel'"));
  assert.ok(consent.includes('isGuardianPhoneEditor(uid)'), 'لا استثناء معرّفي على الخادم');
  assert.ok(consent.includes('req.session.user_id'), 'لا يقرأ معرّف المستخدم الصحيح');
  assert.ok(!consent.includes('req.session.id'), 'يقرأ معرّف الجلسة بدل المستخدم');
  assert.ok(consent.includes('wa.canBroadcast(req.session, school)'), 'لا يفرض صلاحية الإرسال الجماعي على المسار');

  // مسارات الحملة والإرسال ما زالت خالصة canBroadcast (لا استثناء تهاني فيها)
  for (const [from, to, label] of [
    ["app.post('/api/wa/campaign'", "app.post('/api/wa/send'", 'إنشاء الحملة'],
    ["app.post('/api/wa/send'", "app.post('/api/wa/status'", 'الإرسال الرسمي'],
    ["app.post('/api/wa/status'", "app.post('/api/wa/consent'", 'تحديث الحالات'],
  ]) {
    const block = SERVER.slice(SERVER.indexOf(from), SERVER.indexOf(to));
    assert.ok(block.includes('wa.canBroadcast(req.session, school)'), label + ': فُتح على الإرسال الجماعي');
    assert.ok(!block.includes('isGuardianPhoneEditor'), label + ': حُذِم بها استثناء');
  }
  // واجهة الرسائل الجماعية بقيت مقيدة — لا دخول لتهاني إليها
  assert.ok(SRC.includes("(user.role === 'ADMIN' || user.role === 'AGENT' || user.role === 'COUNSELOR') ? { href:'#/broadcast'"), 'تغيّر باب الرسائل الجماعية');
  assert.ok(SRC.includes("else if(page === 'broadcast' && canBroadcastWa(user))"), 'تغيّر توجيه الرسائل الجماعية');
  assert.equal(ctxFor(TEHANI_U).canBroadcastWa(TEHANI_U), false, 'تهاني دخلت خدمة الرسائل الجماعية');
});

// ------------------------------------------------ 6) لا صلاحيات إضافية
test('6) لا صلاحيات جديدة لتهاني خارج واتساب الفردي', () => {
  const t = ctxFor(TEHANI_U, STU);
  assert.equal(t.isManager(TEHANI_U), false, 'أصبحت مديرة/وكيلة');
  assert.equal(t.isAdminRole('ADMINISTRATIVE'), true, 'تغيّر معنى الكادر الإداري');
  // بوابات إدارة المستخدمين/المعلمين لا تزال لل ADMIN/AGENT فقط
  assert.ok(SRC.includes("page === 'users' && (user.role === 'ADMIN' || user.role === 'AGENT')"), 'تغيّر باب المعلمات');
  assert.ok(SRC.includes("page === 'admins' && (user.role === 'ADMIN' || user.role === 'AGENT')"), 'تغيّر باب الإداريين');
  assert.ok(SRC.includes("page === 'backup' && user.role === 'ADMIN'"), 'تغيّر باب النسخ الاحتياطي');
  // المعلمة/الطالبة لا تحصلان على شيء جديد
  assert.equal(ctxFor(TEACHER_U, STU).__waGuardianEnabled(STU), false, 'المعلمة اكتسبت واتساباً');
  assert.equal(ctxFor(STUDENT_U, STU).__waGuardianEnabled(STU), false, 'الطالبة اكتسبت واتساباً');
});

// ------------------------------------------------ 7) سلامة البناء ورفع الإصدار
test('7) البناء سليم والإصدار مرفوع', () => {
  const v = SRC.match(/const __APP_VER = '([^']+)'/);
  assert.ok(v && v[1].includes('tehani-wa'), 'الإصدار لا يحمل وسم هذا الإصلاح');
  assert.ok(v[1].includes('save-persist'), 'الإصدار لا يحمل وسم إصلاح موثوقية الحفظ');
  const n = Number((SW.match(/nibras-v(\d+)/) || [])[1]);
  assert.ok(n >= 139, 'CACHE_NAME لم يُرفَع');
  assert.ok(SRC.includes('sw.js?v=118'), 'نسخة service worker لم تُرفَع');
  assert.ok(SRC.includes('function canWaConsent('), 'دالة البوابة مفقودة');
});

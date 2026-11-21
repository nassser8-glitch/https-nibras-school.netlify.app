'use strict';
// ============================================================
// نبراس — خدمة الرسائل الجماعية عبر واتساب (منطق خالص)
// لا تتصل بقاعدة البيانات ولا ترسل شيئاً عند الاستيراد، ولا تحفظ أي سر.
// كل الدوال هنا نقية/قابلة للاختبار عبر تمرير fetch ومرجع البيئة.
// ============================================================

// الأدوار المسموح لها (الإدارة الكاملة): المدير + الوكيل + وكيلة الشؤون + الموجهة الطلابية
const WA_ROLES = ['ADMIN', 'AGENT', 'SCHOOL_AGENT', 'COUNSELOR'];

// هل يُسمح لهذا المستخدم بالوصول لخدمة الرسائل الجماعية وإرسالها؟
function canBroadcast(session, school) {
  if (!session) return false;
  if (WA_ROLES.indexOf(session.role) === -1) return false;
  if (session.role === 'ADMIN') return true;                          // المدير: كلا القسمين
  if (session.data && session.data.allSchools) return true;           // إداري شامل
  return !school || session.school === school;                       // غير المدير: قسمه فقط
}

// توحيد الرقم: واتساب يقبل الصيغة الدولية بلا + وبلا صفر بادئ
// (تطابق __waIntl في الواجهة: 05XXXXXXXX/01XXXXXXXX/5XXXXXXXX → 966...)
function normalizePhone(raw) {
  let d = String(raw == null ? '' : raw).replace(/\D/g, '');
  if (!d) return '';
  if (d.indexOf('00') === 0) d = d.slice(2);            // 00966... → 966...
  if (/^0[15]\d{8}$/.test(d)) d = '966' + d.slice(1);   // 05/01 XXXXXXXX → 966...
  else if (/^[15]\d{8}$/.test(d)) d = '966' + d;        // 5/1 XXXXXXXX → 966...
  return d;
}
function isValidPhone(p) { return /^\d{8,15}$/.test(String(p || '')); }

// إخفاء الرقم عند عرضه (لا نكشف الأرقام الكاملة في السجلات/الردود)
function maskPhone(p) {
  const s = String(p || '');
  if (s.length < 5) return '•••';
  return s.slice(0, 3) + '•'.repeat(Math.max(0, s.length - 6)) + s.slice(-3);
}

function validateMessage(text) {
  const t = String(text == null ? '' : text);
  if (!t.trim()) return 'empty_message';
  if (t.length > 4096) return 'message_too_long';
  return '';
}

// استبدال المتغيرات {studentName} / {className} / {date} — لكل مستلمة نصّها الخاص
function renderTemplate(tpl, vars) {
  const v = vars || {};
  return String(tpl == null ? '' : tpl)
    .replace(/\{studentName\}/g, String(v.studentName || ''))
    .replace(/\{className\}/g, String(v.className || ''))
    .replace(/\{date\}/g, String(v.date || ''));
}

// رابط «فتح المحادثة» اليدوي (الإرسال الفعلي يدويٌّ من واتساب نفسه)
function waMeLink(phone, text) {
  const p = normalizePhone(phone);
  if (!isValidPhone(p)) return '';
  return 'https://wa.me/' + p + '?text=' + encodeURIComponent(String(text == null ? '' : text));
}

function emptyCounts() {
  return { totalInScope: 0, withValidPhone: 0, invalidOrMissing: 0, noConsent: 0, duplicates: 0, finalCount: 0 };
}

// تحديد المستلمات ضمن نطاق معيّن مع كل الاستثناءات المطلوبة:
// غير النشطة، بلا رقم/رقم غير صالح، بلا موافقة، والمكرّرة — والغياب لا يشمل المتأخرة.
function resolveRecipients(opts) {
  const o = opts || {};
  const students = Array.isArray(o.students) ? o.students : [];
  const attendance = Array.isArray(o.attendance) ? o.attendance : [];
  const target = String(o.target || 'all');
  const classNameOf = typeof o.classNameOf === 'function' ? o.classNameOf : (id => id || '');
  const active = students.filter(s => s && s.active !== false);

  let scope;
  let warn = '';
  if (target === 'class') {
    if (!o.classId) return { list: [], counts: emptyCounts(), warn: 'لم يُحدَّد الفصل.' };
    scope = active.filter(s => s.classId === o.classId);
  } else if (target === 'absent') {
    if (!o.date) return { list: [], counts: emptyCounts(), warn: 'لم يُحدَّد التاريخ.' };
    const dayRecs = attendance.filter(r => r && !r.deleted && r.date === o.date);
    if (!dayRecs.length) {
      // لا نفترض أن الجميع غائبات: بلا بيانات حضور لا يمكن تحديد الغائبات
      return { list: [], counts: emptyCounts(), warn: 'لا توجد بيانات حضور مسجّلة لهذا التاريخ — لا يمكن تحديد الغائبات. اختر تاريخاً آخر أو حدّد المستلمات يدوياً.' };
    }
    const absentIds = {};
    dayRecs.forEach(r => { if (r.status === 'ABSENT') absentIds[r.studentId] = true; });
    scope = active.filter(s => absentIds[s.id]);
  } else if (target === 'manual') {
    const ids = Array.isArray(o.ids) ? o.ids : [];
    if (!ids.length) return { list: [], counts: emptyCounts(), warn: 'لم تُحدَّد أي طالبة.' };
    const idSet = {};
    ids.forEach(x => { if (x) idSet[x] = true; });
    scope = active.filter(s => idSet[s.id]);
  } else {
    scope = active;
  }

  const seen = {};
  let duplicates = 0;
  const list = scope.map(s => {
    const raw = (s.guardianPhone != null && s.guardianPhone !== '') ? s.guardianPhone : (s.whatsapp != null ? s.whatsapp : '');
    const phone = normalizePhone(raw);
    const valid = isValidPhone(phone);
    const consent = s.waConsent === true;
    let reason = '';
    if (!valid) reason = 'no_phone';
    else if (!consent) reason = 'no_consent';
    else if (seen[phone]) { reason = 'duplicate'; duplicates++; }
    const included = !reason;
    if (included) seen[phone] = true;
    return {
      id: s.id,
      name: String(s.fullName || ''),
      classId: s.classId || null,
      className: classNameOf(s.classId),
      phone: included ? phone : '',
      phoneMasked: valid ? maskPhone(phone) : '',
      valid, consent, included, reason,
    };
  });

  const counts = {
    totalInScope: scope.length,
    withValidPhone: list.filter(r => r.valid).length,
    invalidOrMissing: list.filter(r => !r.valid).length,
    noConsent: list.filter(r => r.valid && !r.consent).length,
    duplicates,
    finalCount: list.filter(r => r.included).length,
  };
  return { list, counts, warn };
}

// ===== حالات الرسالة: دمج رتيب لا يتراجع (لا يُنزل «مقبولة» إلى «فُتحت») =====
const STATUS_RANK = { skipped: 0, cancelled: 0, pending: 1, sending: 1, failed: 1, opened: 2, accepted: 3, sent: 3, delivered: 4, read: 5 };
function mergeStatus(cur, next) {
  const a = (cur && STATUS_RANK[cur] != null) ? STATUS_RANK[cur] : 1;
  const b = (next && STATUS_RANK[next] != null) ? STATUS_RANK[next] : 0;
  return b >= a ? next : cur;
}
const MANUAL_STATUSES = ['opened', 'confirmed_sent', 'failed'];

// ===== إعداد Cloud API من البيئة (لا يُخزَّن ولا يُسجَّل أي سر) =====
function configFromEnv(get) {
  const g = typeof get === 'function' ? get : (n => process.env[n]);
  const accessToken = String(g('WHATSAPP_ACCESS_TOKEN') || '');
  const phoneNumberId = String(g('WHATSAPP_PHONE_NUMBER_ID') || '');
  const apiVersion = String(g('WHATSAPP_API_VERSION') || 'v21.0');
  const templateName = String(g('WHATSAPP_TEMPLATE_NAME') || '');
  const templateLang = String(g('WHATSAPP_TEMPLATE_LANG') || 'ar');
  const verifyToken = String(g('WHATSAPP_VERIFY_TOKEN') || '');
  const configured = !!(accessToken && phoneNumberId);
  return { accessToken, phoneNumberId, apiVersion, templateName, templateLang, verifyToken, configured };
}

// ما يُرسَل للواجهة فقط — بلا أسرار (لا توكن ولا معرف كامل)
function publicConfig(cfg) {
  const c = cfg || {};
  return {
    configured: !!c.configured,
    apiVersion: c.apiVersion || '',
    phoneNumberIdSet: !!c.phoneNumberId,
    templateName: c.templateName || '',
    templateLang: c.templateLang || '',
    verifyTokenSet: !!c.verifyToken,
    requirements: c.configured ? [] : ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID'],
  };
}

function cloudSendUrl(cfg) {
  const c = cfg || {};
  return 'https://graph.facebook.com/' + (c.apiVersion || 'v21.0') + '/' + c.phoneNumberId + '/messages';
}
function buildCloudText(phone, text) {
  return { messaging_product: 'whatsapp', recipient_type: 'individual', to: normalizePhone(phone), type: 'text', text: { preview_url: false, body: String(text == null ? '' : text) } };
}
function buildCloudTemplate(phone, cfg, params) {
  return {
    messaging_product: 'whatsapp',
    to: normalizePhone(phone),
    type: 'template',
    template: {
      name: cfg.templateName,
      language: { code: cfg.templateLang || 'ar' },
      components: [{ type: 'body', parameters: (params || []).map(t => ({ type: 'text', text: String(t) })) }],
    },
  };
}

// الإرسال الفعلي عبر Graph API — fetchImpl قابل للحقن (الاختبارات لا تتصل بالشبكة)
async function sendCloudMessage(phone, text, cfg, fetchImpl) {
  if (!cfg || !cfg.accessToken || !cfg.phoneNumberId) return { ok: false, status: 0, error: 'not_configured' };
  const f = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  if (!f) return { ok: false, status: 0, error: 'no_fetch' };
  const body = cfg.templateName ? buildCloudTemplate(phone, cfg, [text]) : buildCloudText(phone, text);
  try {
    const resp = await f(cloudSendUrl(cfg), {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + cfg.accessToken, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body),
      signal: (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(20000) : undefined,
    });
    let j = null;
    try { j = await resp.json(); } catch (_) { j = null; }
    if (resp.status >= 200 && resp.status < 300 && j && Array.isArray(j.messages) && j.messages[0]) {
      return { ok: true, status: resp.status, providerId: String(j.messages[0].id || ''), waStatus: String(j.messages[0].message_status || 'accepted'), error: '' };
    }
    const errObj = j && j.error ? j.error : null;
    const msg = errObj ? (errObj.message || errObj.code) : ('http_' + resp.status);
    return { ok: false, status: resp.status, error: String(msg || 'send_failed').slice(0, 300) };
  } catch (e) {
    return { ok: false, status: 0, error: String((e && e.message) || 'network').slice(0, 300) };
  }
}

module.exports = {
  WA_ROLES, canBroadcast, MANUAL_STATUSES, STATUS_RANK,
  normalizePhone, isValidPhone, maskPhone, validateMessage,
  renderTemplate, waMeLink,
  resolveRecipients, emptyCounts,
  mergeStatus,
  configFromEnv, publicConfig, cloudSendUrl, buildCloudText, buildCloudTemplate, sendCloudMessage,
};

'use strict';
/* =============================================================================
 * خصوصية تحويلات الطالبات — من يرى التحويل
 *
 * التحويلات كانت تصل إلى كل جهاز بلا تصفية: GET /api/db/:school يعيد قسم
 * transfers كاملاً، فكل معلمة تسحب كل تحويلات المدرسة وتقرأ أسماء طلاب زميلاتها
 * وأسباب تحويلهم. الإخفاء في الواجهة وحده ليس خصوصية: البيانات تصل إلى الجهاز
 * ويمكن استخراجها من تخزين المتصفح. القاعدة تُطبَّق على الاستجابة، كما هي
 * في notes-privacy.js للملاحظات.
 *
 * القاعدة المطلوبة:
 *   - المدير (ADMIN): كل تحويلات المدرسة.
 *   - الوكالة (AGENT) والموجهة الطلابية (COUNSELOR): كل تحويلات المدرسة —
 *     طبقة إشراف على المعلمين، فحاجتها لها.
 *   - المعلمة: التحويلات التي أرسلتها هي فقط. أن ترى تحويل زميلة عن طالب
 *     يشترك معك في فصل ليس حقاً لك،ولا часть من عملك.
 *   - الطالب: لا شيء.
 *
 * createdBy هو معرّف ثابت من req.session.user_id عند الإنشاء، ولا يُقبل من
 * جسم الطلب — فلا يمكن انتحال الملكية ولا المخاطبة بالاسم.
 * ========================================================================== */
const ALL_TRANSFERS_ROLES = new Set(['ADMIN', 'AGENT', 'COUNSELOR']);

/** معرّف صاحب التحويل، أو '' إن كان التحويل بلا مرسل معروف. */
function transferOwnerId(t) {
  if (!t || t.createdBy == null) return '';
  return String(t.createdBy).trim();
}

/** هل يقرأ هذا المستخدم هذا التحويل؟ */
function transferVisibleTo(t, viewer) {
  if (!t || typeof t !== 'object') return false;
  if (!viewer || !viewer.role) return false;
  // إشراف: الأدوار الثلاثة ترى المدرسة كلها.
  if (ALL_TRANSFERS_ROLES.has(String(viewer.role))) return true;
  // ما عدا ذلك: صاحب التحويل وحده.
  const owner = transferOwnerId(t);
  const me = viewer.user_id != null ? String(viewer.user_id).trim() : '';
  return !!owner && !!me && owner === me;
}

/** تصفية قسم transfers كاملاً حسب صلاحية القارئ. */
function filterTransfersForViewer(transfers, viewer) {
  if (!Array.isArray(transfers)) return [];
  return transfers.filter(t => transferVisibleTo(t, viewer));
}


// ===== حق الحذف على مستوى الخادم (تحويلات) =====
// الحذف عندنا ناعم: deleted:true ويبقى شاهد قبر لئلا يعود التحويل بالسحب.
// لكن بقاء الشاهد لا يعني أن يُترك لأي عميل. القاعدة نفسها التي في
// الواجهة: المدير يحذف أي تحويل، وسائر الأدوار لا تحذف.
function canDeleteTransfer(transfer, session) {
  if (!session || !session.user_id) return false;
  return String(session.role || '') === 'ADMIN';
}

/**
 * يُطبَّق قبل الدمج: من لا يملك الحق يُلغى عنده عَلَم الحذف ويبقى
 * التحويل كما هو — لا يُرفض دفعه كاملاً فتبقى بقية حفظه سليمة،
 * والمحاولة المرفوضة تُسجَّل في سجل الخادم.
 */
function enforceTransferDeleteRights(incomingTransfers, session, serverTransfers) {
  if (!Array.isArray(incomingTransfers)) return { transfers: incomingTransfers, blocked: [] };
  const serverById = new Map();
  for (const t of (Array.isArray(serverTransfers) ? serverTransfers : [])) {
    if (t && t.id != null) serverById.set(String(t.id), t);
  }
  const blocked = [];
  const out = [];
  for (const t of incomingTransfers) {
    if (!t || typeof t !== 'object' || t.deleted !== true) { out.push(t); continue; }
    if (canDeleteTransfer(t, session)) { out.push(t); continue; }
    const server = t.id != null ? serverById.get(String(t.id)) : null;
    // محذوف عند الخادم أصلا: يبقى الشاهد ولا يُحيا
    if (server && server.deleted === true) { out.push(t); continue; }
    const copy = Object.assign({}, t);
    delete copy.deleted;
    delete copy.deletedAt;
    delete copy.deletedBy;
    blocked.push({
      id: t.id != null ? String(t.id) : null,
      owner: transferOwnerId(server || t),
      by: session && session.user_id ? String(session.user_id) : null,
      role: session && session.role ? String(session.role) : null,
    });
    out.push(copy);
  }
  return { transfers: out, blocked };
}

/**
 * فرض ملكية التحويلات على مستوى الخادم:
 * - التحويل الجديد: createdBy يُشتق دائماً من req.session.user_id الموثوق به، ولا يُقبل من المتصفح.
 * - التحويل القائم: نسخة الخادم هي المرجع للمالك الأصلي.
 * - حل المشكلة (RESOLVED / solution): مقصور على الأدوار الإشرافية (AGENT, COUNSELOR, ADMIN).
 *   المعلمة لا تستطيع اعتماد حل تحويلها بنفسها.
 * - غير المصرح له والتحويلات القديمة بلا createdBy: تُعاد نسخة الخادم كما هي بلا تعديل.
 */
function enforceTransferOwners(incomingTransfers, session, serverTransfers) {
  if (!Array.isArray(incomingTransfers)) return [];
  const me = (session && session.user_id != null) ? String(session.user_id).trim() : '';
  const isPrivileged = session && ALL_TRANSFERS_ROLES.has(String(session.role || ''));
  const canResolve = session && (session.role === 'ADMIN' || session.role === 'AGENT' || session.role === 'COUNSELOR');

  const serverById = new Map();
  for (const t of (Array.isArray(serverTransfers) ? serverTransfers : [])) {
    if (t && t.id != null) serverById.set(String(t.id), t);
  }

  const out = [];
  for (const t of incomingTransfers) {
    if (!t || typeof t !== 'object') continue;
    const server = t.id != null ? serverById.get(String(t.id)) : null;
    if (!server) {
      // تحويل جديد: المالك من الجلسة دائماً وأي createdBy من العميل يُستبدل
      const fresh = Object.assign({}, t);
      if (me) fresh.createdBy = me;
      if (!canResolve && fresh.status === 'RESOLVED') {
        fresh.status = 'PENDING';
        delete fresh.solution;
        delete fresh.resolvedAt;
        delete fresh.resolvedBy;
      }
      out.push(fresh);
      continue;
    }

    // تحويل قائم على الخادم: نسخة الخادم هي المرجع في المالك الأصلي
    const owner = transferOwnerId(server);
    if (isPrivileged) {
      // الأدوار الإشرافية: الحفاظ على المالك الأصلي مع السماح بالحل
      const p = Object.assign({}, t);
      if (owner) p.createdBy = owner; else delete p.createdBy;
      out.push(p);
      continue;
    }

    if (owner && me && owner === me) {
      // المعلمة منشئة التحويل:
      const mine = Object.assign({}, t);
      mine.createdBy = owner;
      // المعلمة لا تملك حق حل التحويل بنفسها
      if (!canResolve && mine.status === 'RESOLVED' && server.status !== 'RESOLVED') {
        mine.status = server.status || 'PENDING';
        mine.solution = server.solution;
        mine.resolvedAt = server.resolvedAt;
        mine.resolvedBy = server.resolvedBy;
      }
      out.push(mine);
      continue;
    }

    // غير المالك وغير المصرح له (بما فيه التحويلات القديمة بلا createdBy):
    // تُعاد نسخة الخادم كما هي بلا أي تعديل
    out.push(Object.assign({}, server));
  }
  return out;
}

module.exports = {
  ALL_TRANSFERS_ROLES,
  transferOwnerId,
  transferVisibleTo,
  filterTransfersForViewer,
  canDeleteTransfer,
  enforceTransferDeleteRights,
  enforceTransferOwners,
};

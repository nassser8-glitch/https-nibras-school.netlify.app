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

module.exports = {
  ALL_TRANSFERS_ROLES,
  transferOwnerId,
  transferVisibleTo,
  filterTransfersForViewer,
};

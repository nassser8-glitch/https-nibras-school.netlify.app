'use strict';

// سياسة التحقق الموحدة لأسماء المستخدمين في قسم البنات:
// - الحسابات الجديدة أو المعدّلة يجب أن تطابق USERNAME_RE (3 إلى 32 رمزاً: a-z, 0-9, ., _, -).
// - الحسابات القديمة (مثل الأسماء القصيرة كـ "fy") تُقبل كما هي دون تعديل أو حذف طالما لم يتغير اسم المستخدم.
const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;
const LEGACY_USERNAME_RE = /^[a-z0-9._-]{1,32}$/;

function normalizeUsername(raw) {
  return String(raw == null ? '' : raw).trim().toLowerCase();
}

function isValidNewUsername(raw) {
  const u = normalizeUsername(raw);
  return USERNAME_RE.test(u);
}

function isValidLegacyUsername(raw) {
  const u = normalizeUsername(raw);
  return LEGACY_USERNAME_RE.test(u);
}

/**
 * يتحقق مما إذا كان اسم المستخدم مسموحاً أثناء المزامنة (PUT /api/db/:school).
 * @param {object} opts
 * @param {string} opts.uname اسم المستخدم القادم في الطلب (مطبّعاً)
 * @param {string} [opts.prevSchoolUname] الاسم السابق في school_data.users
 * @param {string} [opts.dbUserUname] الاسم الفعلي في جدول users بقاعدة البيانات
 * @returns {{ ok: boolean, unchanged: boolean, error?: string }}
 */
function checkSyncUsername({ uname, prevSchoolUname, dbUserUname }) {
  const clean = normalizeUsername(uname);
  if (!clean) return { ok: true, unchanged: true };
  const prevClean = normalizeUsername(prevSchoolUname);
  const dbClean = normalizeUsername(dbUserUname);
  const unchanged = (!!prevClean && prevClean === clean) || (!!dbClean && dbClean === clean);
  if (unchanged) {
    return { ok: true, unchanged: true };
  }
  if (!USERNAME_RE.test(clean)) {
    // إذا كان الاسم قصيراً (1-2 حرف) ولم يأتِ من تعديل إداري صريح بل من سجل قديم غير مسجّل في prevMapU،
    // لا نسمح بإنشاء/تعديل اسم جديد مخالف، لكن السجلات الموجودة في db أو prev تكون unchanged=true أعلاه.
    return { ok: false, unchanged: false, error: 'username_invalid' };
  }
  return { ok: true, unchanged: false };
}

module.exports = {
  USERNAME_RE,
  LEGACY_USERNAME_RE,
  normalizeUsername,
  isValidNewUsername,
  isValidLegacyUsername,
  checkSyncUsername,
};

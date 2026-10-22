'use strict';
// ============================================================
// واتساب: صلاحية الإرسال (موافقة ولي الأمر - إرسال فردي فقط)
// أُزيلت الحملات الجماعية وتكامل Cloud API، ويبقى هذا الملف لتأمين
// مسار الموافقة الفردية POST /api/wa/consent فقط.
// ============================================================

const WA_ROLES = ['ADMIN', 'AGENT', 'SCHOOL_AGENT', 'COUNSELOR'];

function canBroadcast(session, school) {
  if (!session) return false;
  if (WA_ROLES.indexOf(session.role) === -1) return false;
  if (session.role === 'ADMIN') return true;                          // المدير: كل المدارس
  if (session.data && session.data.allSchools) return true;           // صلاحية شاملة
  return !school || session.school === school;                       // غير المدير: مدرسته فقط
}

module.exports = { canBroadcast, WA_ROLES };

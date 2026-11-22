'use strict';
// ============================================================
// نبراس — منطق إعلانات المدرسة (نقي وقابل للاختبار)
// ============================================================

const ANNOUNCEMENT_CATEGORIES = [
  { id: 'general',  label: '📢 إعلان عام',          icon: '📢', color: '#2563eb', bg: '#eff6ff' },
  { id: 'warning',  label: '⚠️ تنبيه مهم',          icon: '⚠️', color: '#d97706', bg: '#fffbeb' },
  { id: 'event',    label: '📅 فعالية أو مناسبة',   icon: '📅', color: '#7c3aed', bg: '#f5f3ff' },
  { id: 'academic', label: '📚 إعلان أكاديمي',      icon: '📚', color: '#0891b2', bg: '#ecfeff' },
  { id: 'honor',    label: '🏆 تكريم وتهنئة',       icon: '🏆', color: '#059669', bg: '#ecfdf5' },
  { id: 'urgent',   label: '📌 إعلان عاجل',         icon: '📌', color: '#dc2626', bg: '#fef2f2' },
];

const ANNOUNCEMENT_STATUSES = ['draft', 'published', 'paused'];
const ANNOUNCEMENT_TARGETS = ['all', 'primary', 'middle', 'high', 'class', 'student'];
const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024; // 3 MB

function categoryMeta(id) {
  return ANNOUNCEMENT_CATEGORIES.find(c => c.id === id) || ANNOUNCEMENT_CATEGORIES[0];
}

function stageBucketOfGradeName(name) {
  const n = String(name || '').trim();
  if (!n) return '';
  if (n.indexOf('تمهيد') >= 0 || n.indexOf('روض') >= 0) return 'kindergarten';
  if (n.indexOf('ابتدائي') >= 0) return 'primary';
  if (n.indexOf('متوسط') >= 0) return 'middle';
  if (n.indexOf('ثانوي') >= 0) return 'high';
  return '';
}

function normalizeDateStr(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

function isAnnouncementActiveOnDate(ann, todayIso) {
  if (!ann) return false;
  const status = String(ann.status || '');
  if (status !== 'published') return false;
  const today = normalizeDateStr(todayIso) || new Date().toISOString().slice(0, 10);
  const start = normalizeDateStr(ann.startDate != null ? ann.startDate : ann.start_date);
  const end = normalizeDateStr(ann.endDate != null ? ann.endDate : ann.end_date);
  if (start && today < start) return false;
  if (end && today > end) return false;
  return true;
}

function isAnnouncementExpired(ann, todayIso) {
  if (!ann) return false;
  const today = normalizeDateStr(todayIso) || new Date().toISOString().slice(0, 10);
  const end = normalizeDateStr(ann.endDate != null ? ann.endDate : ann.end_date);
  return !!(end && today > end);
}

function matchesTarget(ann, student, gradeByIdMap, classByIdMap) {
  if (!ann || !student || student.active === false) return false;
  const tType = String(ann.targetType != null ? ann.targetType : (ann.target_type || 'all'));
  const tVal = String(ann.targetValue != null ? ann.targetValue : (ann.target_value || ''));
  if (tType === 'all') return true;
  if (tType === 'student') return String(student.id || '') === tVal;
  if (tType === 'class') return String(student.classId || '') === tVal;
  if (tType === 'primary' || tType === 'middle' || tType === 'high') {
    const cls = classByIdMap && student.classId ? classByIdMap[student.classId] : null;
    const gr = cls && gradeByIdMap && cls.gradeId ? gradeByIdMap[cls.gradeId] : null;
    return stageBucketOfGradeName(gr && gr.name) === tType;
  }
  return false;
}

function resolveTargetedStudents(ann, students, grades, classes) {
  const gradeMap = {};
  (Array.isArray(grades) ? grades : []).forEach(g => { if (g && g.id) gradeMap[g.id] = g; });
  const classMap = {};
  (Array.isArray(classes) ? classes : []).forEach(c => { if (c && c.id) classMap[c.id] = c; });
  return (Array.isArray(students) ? students : []).filter(s => matchesTarget(ann, s, gradeMap, classMap));
}

function sortAnnouncements(list) {
  return (Array.isArray(list) ? list.slice() : []).sort((a, b) => {
    const pa = a && a.pinned ? 1 : 0;
    const pb = b && b.pinned ? 1 : 0;
    if (pb !== pa) return pb - pa;
    const ta = Date.parse((a && (a.createdAt || a.created_at)) || '') || 0;
    const tb = Date.parse((b && (b.createdAt || b.created_at)) || '') || 0;
    return tb - ta;
  });
}

function sanitizeAttachment(att) {
  if (!att || !att.data) return { ok: true, name: '', type: '', data: '' };
  const data = String(att.data || '').trim();
  const m = /^data:(image\/(?:png|jpeg|jpg|webp|gif)|application\/pdf);base64,([A-Za-z0-9+/=]+)$/i.exec(data);
  if (!m) return { ok: false, error: 'unsupported_attachment_type' };
  const approxBytes = Math.floor((m[2].length * 3) / 4);
  if (approxBytes > MAX_ATTACHMENT_BYTES) return { ok: false, error: 'attachment_too_large' };
  const name = String(att.name || 'attachment').trim().slice(0, 180);
  const type = m[1].toLowerCase();
  return { ok: true, name, type, data };
}

function validateAnnouncementPayload(body) {
  const b = body || {};
  const title = String(b.title || '').trim();
  if (!title) return { ok: false, error: 'title_required' };
  if (title.length > 200) return { ok: false, error: 'title_too_long' };
  const content = String(b.body != null ? b.body : (b.content || '')).trim();
  if (content.length > 10000) return { ok: false, error: 'body_too_long' };
  const category = ANNOUNCEMENT_CATEGORIES.some(c => c.id === b.category) ? b.category : 'general';
  const status = ANNOUNCEMENT_STATUSES.includes(b.status) ? b.status : 'published';
  const targetType = ANNOUNCEMENT_TARGETS.includes(b.targetType) ? b.targetType : 'all';
  const targetValue = String(b.targetValue || '').trim();
  if ((targetType === 'class' || targetType === 'student') && !targetValue) {
    return { ok: false, error: 'target_value_required' };
  }
  const startDate = normalizeDateStr(b.startDate);
  const endDate = normalizeDateStr(b.endDate);
  if (startDate && endDate && endDate < startDate) {
    return { ok: false, error: 'invalid_date_range' };
  }
  const att = sanitizeAttachment(b.attachment);
  if (!att.ok) return { ok: false, error: att.error };
  return {
    ok: true,
    value: {
      title,
      body: content,
      category,
      pinned: !!b.pinned,
      status,
      targetType,
      targetValue: (targetType === 'class' || targetType === 'student') ? targetValue : '',
      startDate,
      endDate,
      attachmentName: att.name,
      attachmentType: att.type,
      attachmentData: att.data,
    },
  };
}

module.exports = {
  ANNOUNCEMENT_CATEGORIES,
  ANNOUNCEMENT_STATUSES,
  ANNOUNCEMENT_TARGETS,
  MAX_ATTACHMENT_BYTES,
  categoryMeta,
  stageBucketOfGradeName,
  normalizeDateStr,
  isAnnouncementActiveOnDate,
  isAnnouncementExpired,
  matchesTarget,
  resolveTargetedStudents,
  sortAnnouncements,
  sanitizeAttachment,
  validateAnnouncementPayload,
};

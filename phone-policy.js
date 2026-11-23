'use strict';

// صلاحية تعديل رقم الجوال الذاتي: مقتصرة على الإداريين/الإداريات والموجهين/الموجهات الطلابيين فقط.
const PHONE_EDIT_ALLOWED_ROLES = ['ADMINISTRATIVE', 'COUNSELOR'];

function canSelfEditPhone(role) {
  return PHONE_EDIT_ALLOWED_ROLES.includes(String(role || '').toUpperCase());
}

function toAsciiDigits(str) {
  return String(str == null ? '' : str)
    .replace(/[\u0660-\u0669]/g, ch => String(ch.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, ch => String(ch.charCodeAt(0) - 0x06F0));
}

function normalizePhone(raw) {
  const ascii = toAsciiDigits(raw).trim();
  if (!ascii) return '';
  return ascii.replace(/[\s\-().]/g, '');
}

function validatePhone(raw) {
  const clean = normalizePhone(raw);
  if (!clean) return { ok: false, error: 'phone_required' };
  if (!/^\+?\d{8,15}$/.test(clean)) return { ok: false, error: 'invalid_phone' };
  return { ok: true, phone: clean };
}

module.exports = {
  PHONE_EDIT_ALLOWED_ROLES,
  canSelfEditPhone,
  normalizePhone,
  validatePhone,
};

'use strict';
// ============================================================
// نبراس — خادم آمن (Express + PostgreSQL + جلسات حقيقية)
// الاستبدال الكامل لخادم JSON + SYNC_KEY القديم
// ============================================================
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const db = require('./db');

const ROOT = process.env.WEBROOT || path.join(__dirname, 'public');
const PORT = Number(process.env.PORT) || 8090;
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS) || 24 * 60 * 60 * 1000; // 24 ساعة
const SESSION_COOKIE = 'nibras_session';
const MAX_BODY_MB = Number(process.env.MAX_BODY_MB) || 20;
const BCRYPT_ROUNDS = 10;

// بريد استعادة الرقم السري (SMTP) — يأتي من متغيرات البيئة (لا يُحفظ في الكود)
const MAIL_HOST = process.env.MAIL_HOST || '';
const MAIL_PORT = Number(process.env.MAIL_PORT) || 587;
const MAIL_SECURE = Number(process.env.MAIL_PORT) === 465;
const MAIL_USER = process.env.MAIL_USER || '';
const MAIL_PASS = process.env.MAIL_PASS || '';
const MAIL_FROM = process.env.MAIL_FROM || MAIL_USER;
let mailTransporter = null;
function getMailer() {
  if (!MAIL_HOST || !MAIL_USER || !MAIL_PASS) return null;
  if (!mailTransporter) {
    mailTransporter = nodemailer.createTransport({
      host: MAIL_HOST, port: MAIL_PORT, secure: MAIL_SECURE,
      auth: { user: MAIL_USER, pass: MAIL_PASS },
    });
  }
  return mailTransporter;
}
async function sendResetEmail(toEmail, code, expiresInMin) {
  const m = getMailer();
  if (!m) return false;
  try {
    await m.sendMail({
      from: '"نظام نبراس" <' + MAIL_FROM + '>',
      to: toEmail,
      subject: 'نبراس — رمز استعادة الرقم السري',
      text: 'نظام نبراس\n\nرمز استعادة الرقم السري الخاص بك هو: ' + code + '\nالرمز صالح لمدة ' + expiresInMin + ' دقائق.\n\nإذا لم تطلب هذا الرمز، تجاهل هذه الرسالة.',
      html: '<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;max-width:520px;margin:auto;border:1px solid #e2e8f0;border-radius:12px;padding:24px;color:#1f2937">'
        + '<h2 style="color:#0f766e;margin:0 0 8px">نظام نبراس</h2>'
        + '<p>رمز استعادة الرقم السري الخاص بك هو:</p>'
        + '<div style="font-size:34px;font-weight:800;letter-spacing:10px;text-align:center;background:#f1f5f9;border-radius:8px;padding:14px;direction:ltr">' + code + '</div>'
        + '<p>الرمز صالح لمدة <b>' + expiresInMin + ' دقائق</b>.</p>'
        + '<p style="color:#64748b;font-size:13px">إذا لم تطلب هذا الرمز، تجاهل هذه الرسالة.</p>'
        + '</div>',
    });
    return true;
  } catch (e) {
    console.error('[mail] فشل إرسال البريد:', e.message);
    return false;
  }
}

const PASSWORD_MIN = 8;
const PASSWORD_RE = /^(?=.*[A-Za-z])[A-Za-z0-9@#$%^&*!._\-+=]{8,}$/;

// أدوار كتابة الأقسام (تطابق صلاحيات الواجهة — تُفرض على الخادم)
const SECTION_RULES = {
  users:       ['ADMIN', 'AGENT'],
  grades:      ['ADMIN', 'AGENT', 'COUNSELOR'],
  classes:     ['ADMIN', 'AGENT', 'COUNSELOR'],
  students:    ['ADMIN', 'AGENT', 'COUNSELOR'],
  attendance:  ['ADMIN', 'AGENT', 'COUNSELOR', 'TEACHER'],
  notes:       ['ADMIN', 'AGENT', 'COUNSELOR', 'TEACHER'],
  transfers:   ['ADMIN', 'AGENT', 'COUNSELOR', 'TEACHER'],
  activities:  ['ADMIN', 'AGENT', 'COUNSELOR', 'TEACHER'],
  timetable:   ['ADMIN', 'AGENT', 'COUNSELOR', 'TEACHER'],
  videos:      ['ADMIN', 'AGENT'],
  maintenance: ['ADMIN', 'AGENT', 'COUNSELOR', 'TEACHER', 'ADMINISTRATIVE'],
};
const SECTION_KEYS = ['users','grades','classes','students','attendance','notes','transfers','activities','timetable','videos','maintenance'];
// حقول سرية لا تُخزن/تُعاد أبدًا
const STRIP_FIELDS = ['password','password_hash','secret','initialSecret','resetCode','resetExpires','token_hash'];

const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
app.use(express.json({ limit: MAX_BODY_MB + 'mb' }));

/* ================= أمان HTTP ================= */
function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-src 'self' https://*.sharepoint.com https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com");
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  next();
}
app.use(securityHeaders);

// فرض HTTPS اختياري (خلف بروكسي وسيط يُنهي TLS)
if (process.env.FORCE_HTTPS === '1') {
  app.use((req, res, next) => {
    if (!req.secure && req.url !== '/api/health') {
      res.redirect('https://' + req.headers.host + req.url);
      return;
    }
    next();
  });
}

/* ================= الحد من المعدل ================= */
const rateBuckets = new Map();
function rateLimit(routeKey, limit, windowMs, req) {
  const ip = req.ip || 'unknown';
  const k = routeKey + '|' + ip;
  const now = Date.now();
  let b = rateBuckets.get(k);
  if (!b || b.start + windowMs < now) { b = { start: now, count: 0 }; rateBuckets.set(k, b); }
  b.count++;
  return b.count > limit;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of rateBuckets) if (b.start + 60 * 60 * 1000 < now) rateBuckets.delete(k);
}, 60 * 1000).unref();

/* حد محاولات الدخول: يُحتسب فقط فشل المصادقة (لا يُقفل المستخدمين الشرعيين بتكرار الدخول الناجح) */
const loginFails = new Map();
function loginFailBucket(req) {
  const ip = req.ip || 'unknown';
  const k = 'login|' + ip;
  const now = Date.now();
  let b = loginFails.get(k);
  if (!b || b.start + 15 * 60 * 1000 < now) { b = { start: now, count: 0 }; loginFails.set(k, b); }
  return b;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of loginFails) if (b.start + 60 * 60 * 1000 < now) loginFails.delete(k);
}, 60 * 1000).unref();

/* ================= الجلسة ================= */
function readCookies(req) {
  const raw = req.headers.cookie || '';
  const out = {};
  raw.split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) { try { out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); } catch (e) {} }
  });
  return out;
}
function cookieOpts(req, maxAgeMs) {
  return [
    SESSION_COOKIE + '=' + encodeURIComponent(req._sessionToken),
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    req.secure ? 'Secure' : null,
    'Max-Age=' + Math.floor((maxAgeMs || SESSION_TTL_MS) / 1000),
  ].filter(Boolean).join('; ');
}

function authUser(req) {
  const token = readCookies(req)[SESSION_COOKIE];
  if (!token) return Promise.resolve(null);
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  return db.sessionByTokenHash(hash).then(row => {
    if (!row) return null;
    req._sessionToken = token;
    req._tokenHash = hash;
    return row;
  });
}
function fail(res) { return e => { console.error('[500]', e); res.status(500).json({ error: 'server' }); }; }
function requireAuth(req, res, next) {
  authUser(req).then(s => {
    if (!s) return res.status(401).json({ error: 'unauthorized' });
    req.session = s;
    next();
  }).catch(fail(res));
}
function sendUser(u, sessionRow) {
  const user = { id: u.id, school: u.school, name: u.name, email: u.email, role: u.role, active: u.active, firstLogin: u.first_login, ...(u.data || {}) };
  STRIP_FIELDS.forEach(f => delete user[f]);
  if (sessionRow) user.session = { created: sessionRow.created_at, expires: sessionRow.expires_at };
  return user;
}

// ===== مزامنة بيانات المستخدم في نسخة القسم (school_data.users) مع أي تغيير حسابي =====
// حتى لا تتعارض الجداول (users) مع نسخة البيانات التي تعرضها الواجهة
async function updateSchoolUser(school, userId, fields) {
  const rec = await db.getSchoolData(school);
  if (!rec.data || !Array.isArray(rec.data.users)) return;
  const u = rec.data.users.find(x => x.id === userId);
  if (!u) return;
  Object.assign(u, fields);
  STRIP_FIELDS.forEach(f => delete u[f]);
  await db.setSchoolData(school, rec.data, Date.now());
}
async function appendSchoolUser(school, userObj) {
  const rec = await db.getSchoolData(school);
  const data = rec.data || { users: [], grades: [], classes: [], students: [], attendance: [], notes: [], transfers: [] };
  if (!Array.isArray(data.users)) data.users = [];
  const clean = Object.assign({}, userObj);
  STRIP_FIELDS.forEach(f => delete clean[f]);
  const i = data.users.findIndex(x => x.id === clean.id);
  if (i >= 0) data.users[i] = clean; else data.users.push(clean);
  await db.setSchoolData(school, data, Date.now());
}

/* ================= /api/auth ================= */
app.post('/api/auth/login', (req, res) => {
  (async () => {
    const fails = loginFailBucket(req);
    if (fails.count >= 10) return res.status(429).json({ error: 'rate_limited' });
    const email = String(req.body && req.body.email || '').trim().toLowerCase();
    const password = String(req.body && req.body.password || '');
    if (!email || !password) return res.status(400).json({ error: 'missing' });
    const u = await db.userByEmail(email);
    if (!u || !u.active) { fails.count++; return res.status(401).json({ error: 'invalid' }); }
    const ok = await bcrypt.compare(password, u.password_hash);
    if (!ok) { fails.count++; return res.status(401).json({ error: 'invalid' }); }
    fails.count = 0;

    // تنظيف جلسات هذا المستخدم القديمة ثم إنشاء جلسة جديدة
    await db.deleteUserSessions(u.id);
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    await db.createSession(u.id, u.school, tokenHash, SESSION_TTL_MS, req.ip, (req.headers['user-agent'] || '').slice(0, 250));

    const data = await db.getSchoolData(u.school);
    if (data && data.data) {
      const hist = Array.isArray(u.data.loginHistory) ? u.data.loginHistory.slice(-299) : [];
      hist.push(new Date().toISOString());
      const upd = { lastLogin: new Date().toISOString(), loginCount: (u.data.loginCount || 0) + 1, loginHistory: hist };
      await db.updateUserProfile(u.id, { data: Object.assign({}, u.data, upd) });
      await updateSchoolUser(u.school, u.id, upd);
    }
    req._sessionToken = token;
    const row = await db.sessionByTokenHash(tokenHash);
    res.setHeader('Set-Cookie', cookieOpts(req));
    res.json({ ok: true, user: sendUser(u, row) });
  })().catch(fail(res));
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  db.deleteSession(req._tokenHash).catch(() => {});
  res.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, sameSite: 'strict' });
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  authUser(req).then(async s => {
    if (!s) return res.status(401).json({ error: 'unauthorized' });
    const u = await db.userById(s.user_id);
    if (!u || !u.active) { await db.deleteSession(s.token_hash).catch(() => {}); return res.status(401).json({ error: 'unauthorized' }); }
    res.json({ ok: true, user: sendUser(u, s) });
  }).catch(fail(res));
});

app.post('/api/auth/change-password', requireAuth, (req, res) => {
  (async () => {
    if (rateLimit('chpwd', 6, 15 * 60 * 1000, req)) return res.status(429).json({ error: 'rate_limited' });
    const pw = String(req.body && req.body.newPassword || '');
    if (!PASSWORD_RE.test(pw)) return res.status(400).json({ error: 'weak_password', min: PASSWORD_MIN });
    const hash = await bcrypt.hash(pw, BCRYPT_ROUNDS);
    await db.updateUserPasswordHash(req.session.user_id, hash, false);
    const email = String(req.body && req.body.email || '').trim().toLowerCase();
    if (email) {
      const me = await db.userById(req.session.user_id);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'bad_email' });
      const other = await db.userByEmail(email);
      if (other && other.id !== me.id) return res.status(409).json({ error: 'email_taken' });
      await db.insertUser(Object.assign({}, me, { email }));
      await updateSchoolUser(req.session.school, req.session.user_id, { email });
    }
    await updateSchoolUser(req.session.school, req.session.user_id, { firstLogin: false });
    const u = await db.userById(req.session.user_id);
    res.json({ ok: true, user: sendUser(u, req.session) });
  })().catch(fail(res));
});

app.post('/api/auth/update-profile', requireAuth, (req, res) => {
  (async () => {
    if (rateLimit('profile', 12, 15 * 60 * 1000, req)) return res.status(429).json({ error: 'rate_limited' });
    const u = await db.userById(req.session.user_id);
    if (!u) return res.status(401).json({ error: 'unauthorized' });

    const email = String(req.body && req.body.email || '').trim().toLowerCase();
    if (email) {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'bad_email' });
      const other = await db.userByEmail(email);
      if (other && other.id !== u.id) return res.status(409).json({ error: 'email_taken' });
      await db.insertUser(Object.assign({}, u, { email }));
    }
    const pw = String(req.body && req.body.newPassword || '');
    if (pw) {
      if (!PASSWORD_RE.test(pw)) return res.status(400).json({ error: 'weak_password', min: PASSWORD_MIN });
      const hash = await bcrypt.hash(pw, BCRYPT_ROUNDS);
      await db.updateUserPasswordHash(u.id, hash, false);
      await updateSchoolUser(u.school, u.id, { firstLogin: false });
    }
    if (email) await updateSchoolUser(u.school, u.id, { email });
    const updated = await db.userById(u.id);
    res.json({ ok: true, user: sendUser(updated, req.session) });
  })().catch(fail(res));
});

/* ============ استعادة كلمة المرور (رمز يظهر على الشاشة — لا خدمة إيميل) ============ */
const RESET_CODE_TTL_MS = 10 * 60 * 1000;
app.post('/api/auth/forgot-password', (req, res) => {
  (async () => {
    if (rateLimit('forgot', 5, 15 * 60 * 1000, req)) return res.status(429).json({ error: 'rate_limited' });
    const email = String(req.body && req.body.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'missing' });
    const u = await db.userByEmail(email);
    if (!u || !u.active) return res.status(404).json({ error: 'not_found' });
    const code = String(Math.floor(100000 + Math.random() * 900000));
    await db.updateUserProfile(u.id, { data: Object.assign({}, u.data, { resetCode: code, resetExpires: Date.now() + RESET_CODE_TTL_MS }) });
    // إرسال الرمز إلى بريد المستخدم عبر SMTP (nassser8@gmail.com). إن لم يُضبط البريد: نعرضه في الاستجابة (وضع التطوير).
    const sent = await sendResetEmail(u.email, code, Math.round(RESET_CODE_TTL_MS / 60000));
    res.json(sent ? { ok: true, expiresInMin: 10 } : { ok: true, code, expiresInMin: 10, fallback: true });
  })().catch(fail(res));
});

app.post('/api/auth/recover-password', (req, res) => {
  (async () => {
    if (rateLimit('recover', 8, 15 * 60 * 1000, req)) return res.status(429).json({ error: 'rate_limited' });
    const email = String(req.body && req.body.email || '').trim().toLowerCase();
    const code = String(req.body && req.body.code || '').trim();
    const pw = String(req.body && req.body.newPassword || '');
    if (!email || !code || !pw) return res.status(400).json({ error: 'missing' });
    const u = await db.userByEmail(email);
    if (!u || !u.active) return res.status(404).json({ error: 'not_found' });
    const stored = u.data && u.data.resetCode;
    const exp = u.data && u.data.resetExpires;
    if (!stored || String(stored) !== code) return res.status(400).json({ error: 'bad_code' });
    if (!exp || exp < Date.now()) return res.status(400).json({ error: 'code_expired' });
    if (!PASSWORD_RE.test(pw)) return res.status(400).json({ error: 'weak_password', min: PASSWORD_MIN });
    const hash = await bcrypt.hash(pw, BCRYPT_ROUNDS);
    await db.updateUserPasswordHash(u.id, hash, false);
    const cleanData = Object.assign({}, u.data);
    delete cleanData.resetCode;
    delete cleanData.resetExpires;
    await db.updateUserProfile(u.id, { data: cleanData });
    await updateSchoolUser(u.school, u.id, { firstLogin: false });
    await db.deleteUserSessions(u.id);
    res.json({ ok: true });
  })().catch(fail(res));
});

/* =============== إدارة الحسابات (مدير / وكيل) =============== */
function canManageUsers(user, targetSchool) {
  if (user.role === 'ADMIN') return true;
  if (user.role === 'AGENT' && user.school === targetSchool) return true;
  return false;
}
function validRoleFor(actor, role) {
  if (actor.role === 'ADMIN') return ['ADMIN','AGENT','COUNSELOR','TEACHER','ADMINISTRATIVE'].includes(role);
  return ['COUNSELOR','TEACHER'].includes(role); // الوكيل لا ينشئ مديرًا أو وكيلًا
}

app.post('/api/auth/admin/create-user', requireAuth, (req, res) => {
  (async () => {
    if (rateLimit('create', 20, 15 * 60 * 1000, req)) return res.status(429).json({ error: 'rate_limited' });
    const school = req.session.school;
    if (!canManageUsers(req.session, school)) return res.status(403).json({ error: 'forbidden' });
    const name = String(req.body && req.body.name || '').trim();
    const email = String(req.body && req.body.email || '').trim().toLowerCase();
    const pw = String(req.body && req.body.password || '');
    const role = String(req.body && req.body.role || '').toUpperCase();
    if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !PASSWORD_RE.test(pw) || !validRoleFor(req.session, role))
      return res.status(400).json({ error: 'invalid', min: PASSWORD_MIN });
    if (await db.userByEmail(email)) return res.status(409).json({ error: 'email_taken' });
    const hash = await bcrypt.hash(pw, BCRYPT_ROUNDS);
    const id = 'id_' + crypto.randomBytes(6).toString('hex');
    await db.insertUser({ id, school, name, email, password_hash: hash, role, active: true, first_login: true, data: {} });
    const created = await db.userById(id);
    await appendSchoolUser(school, sendUser(created));
    res.json({ ok: true, user: sendUser(created) });
  })().catch(fail(res));
});

app.post('/api/auth/admin/reset-password', requireAuth, (req, res) => {
  (async () => {
    if (rateLimit('reset', 15, 15 * 60 * 1000, req)) return res.status(429).json({ error: 'rate_limited' });
    const userId = String(req.body && req.body.userId || '');
    const target = await db.userById(userId);
    if (!target) return res.status(404).json({ error: 'not_found' });
    if (!canManageUsers(req.session, target.school)) return res.status(403).json({ error: 'forbidden' });
    const temp = crypto.randomBytes(6).toString('hex').slice(0, 10); // 10 محارف عشوائية
    const hash = await bcrypt.hash(temp, BCRYPT_ROUNDS);
    await db.updateUserPasswordHash(target.id, hash, true);
    await updateSchoolUser(target.school, target.id, { firstLogin: true });
    await db.deleteUserSessions(target.id); // إنهاء جلسات المستخدم فورًا
    res.json({ ok: true, userId: target.id, name: target.name, tempPassword: temp, firstLogin: true });
  })().catch(fail(res));
});

/* ================= قائمة الحسابات للدخول (بلا أي كلمات مرور) ================= */
app.get('/api/auth/accounts', (req, res) => {
  db.listAllUsers().then(rows => {
    const accounts = rows
      .filter(u => u.active !== false)
      .map(u => ({ name: u.name, email: u.email, role: u.role, school: u.school }));
    res.json({ ok: true, accounts });
  }).catch(fail(res));
});

/* ================= /api/db (البيانات) ================= */
function schoolAccess(session, school) {
  if (session.role === 'ADMIN') return true;
  return session.school === school;
}
function jsonEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
// هل تغيير قسم المستخدمين مسموح لغير المدير/الوكيل؟
// يُستثنى حساب المستخدم نفسه من المقارنة (تحديثات تلقائية كـ lastSeenAt لا تتعارض مع نسخة العميل المتأخرة)
function usersSectionAllowedFor(role, selfId, prevUsers, nextUsers) {
  if (role === 'ADMIN' || role === 'AGENT') return true;
  const srt = arr => (arr || []).filter(u => u.id !== selfId).sort((a, b) => a.id < b.id ? -1 : 1);
  return jsonEqual(srt(prevUsers), srt(nextUsers));
}

// ===== مطابقة جدول المستخدمين (المصادقة) مع نسخة بيانات القسم بعد كتابة قسم users =====
async function userPresentInOtherSchool(id, school) {
  const other = school === 'BOYS' ? 'GIRLS' : 'BOYS';
  const rec = await db.getSchoolData(other);
  return rec.data && Array.isArray(rec.data.users) && rec.data.users.some(u => u.id === id);
}
async function reconcileUserTable(school, prevUsers, nextUsers) {
  const nextMap = new Map((nextUsers || []).map(u => [u.id, u]));
  const prevMap = new Map((prevUsers || []).map(u => [u.id, u]));
  // هل البريد متاح لتغييره لمستخدم معيّن؟ (يمنع تصادم المفتاح الفريد عند اشتراك حسابين بالبريد نفسه)
  const emailFreeFor = async (id, email) => {
    const other = await db.userByEmail(email);
    return !other || other.id === id;
  };
  for (const p of (prevUsers || [])) {
    const n = nextMap.get(p.id);
    if (!n) {
      // أُزيل من بيانات هذا القسم: إن وُجد في القسم الآخر فهو منقول، وإلا فهو محذوف
      if (await userPresentInOtherSchool(p.id, school)) await db.setUserSchool(p.id, school === 'BOYS' ? 'GIRLS' : 'BOYS');
      else await db.deactivateUser(p.id);
      continue;
    }
    const tbl = await db.userById(p.id);
    if (!tbl) continue;
    if ((tbl.active ? true : false) !== (n.active !== false)) await db.setUserActive(p.id, n.active !== false);
    if (n.email && tbl.email !== n.email && await emailFreeFor(p.id, n.email)) await db.updateUserIdentity(p.id, { email: n.email });
    if (n.name && tbl.name !== n.name) await db.updateUserIdentity(p.id, { name: n.name });
  }
  // مستخدم جديد في بيانات هذا القسم (مثلاً منقول إليه): إعادة تفعيل حسابه وتصحيح قسمه
  for (const n of (nextUsers || [])) {
    if (prevMap.has(n.id)) continue;
    const tbl = await db.userById(n.id);
    if (!tbl) continue;
    await db.setUserSchool(n.id, school);
    await db.setUserActive(n.id, n.active !== false);
    if (n.email && tbl.email !== n.email && await emailFreeFor(n.id, n.email)) await db.updateUserIdentity(n.id, { email: n.email });
  }
}

app.get('/api/db/:school', requireAuth, (req, res) => {
  (async () => {
    const school = String(req.params.school).toUpperCase();
    if (!db.SCHOOLS.includes(school)) return res.status(400).json({ error: 'bad_school' });
    if (!schoolAccess(req.session, school)) return res.status(403).json({ error: 'forbidden' });
    const rec = await db.getSchoolData(school);
    res.json(rec.data ? { ts: rec.ts, data: rec.data } : { ts: 0, data: null });
  })().catch(fail(res));
});

app.put('/api/db/:school', requireAuth, (req, res) => {
  (async () => {
    if (rateLimit('dbwrite', 180, 60 * 1000, req)) return res.status(429).json({ error: 'rate_limited' });
    const school = String(req.params.school).toUpperCase();
    if (!db.SCHOOLS.includes(school)) return res.status(400).json({ error: 'bad_school' });
    if (!schoolAccess(req.session, school)) return res.status(403).json({ error: 'forbidden' });
    if (req.session.first_login) return res.status(403).json({ error: 'change_password_first' });

    const data = req.body && req.body.data;
    if (!data || typeof data !== 'object' || Array.isArray(data))
      return res.status(400).json({ error: 'invalid_payload' });
    for (const k of ['users','grades','classes','students','attendance','notes','transfers','maintenance']) {
      if (!Array.isArray(data[k])) return res.status(400).json({ error: 'invalid_section:' + k });
    }
    const ts = Number(req.body.ts) || Date.now();
    const prev = await db.getSchoolData(school);
    if (prev.data && prev.ts && ts < prev.ts) {
      // رفض النسخة الأقدم (آخر حافظ يربح)
      return res.json({ ok: false, reason: 'stale', ts: prev.ts });
    }

    // ===== تحقق الصلاحيات لكل قسم تغيّر =====
    for (const key of SECTION_KEYS) {
      const a = prev.data ? prev.data[key] : undefined;
      const b = data[key];
      if (jsonEqual(a, b)) continue;
      if (key === 'users') {
        if (!usersSectionAllowedFor(req.session.role, req.session.user_id, a, b))
          return res.status(403).json({ error: 'forbidden_section:' + key });
      } else if (!SECTION_RULES[key].includes(req.session.role)) {
        return res.status(403).json({ error: 'forbidden_section:' + key });
      }
    }

    // تنظيف دفاعي: لا تُخزن أي بيانات اعتماد في نسخة البيانات
    const clean = JSON.parse(JSON.stringify(data));
    if (Array.isArray(clean.users)) clean.users.forEach(u => STRIP_FIELDS.forEach(f => delete u[f]));
    await db.setSchoolData(school, clean, ts);
    // مزامنة جدول المصادقة مع أي تغيير في قسم المستخدمين (حذف/نقل/تعطيل)
    if (['ADMIN','AGENT'].includes(req.session.role)) {
      const prevUsers = prev.data && prev.data.users;
      if (!jsonEqual(prevUsers, clean.users)) await reconcileUserTable(school, prevUsers, clean.users);
    }
    res.json({ ok: true, ts });
  })().catch(fail(res));
});

/* ================= صحة وأمان ================= */
app.get('/api/health', (req, res) => {
  res.json({
    ok: true, schools: db.SCHOOLS, db: 'postgres',
    mail: {
      host: !!process.env.MAIL_HOST,
      user: !!process.env.MAIL_USER,
      pass: !!process.env.MAIL_PASS,
      passLen: (process.env.MAIL_PASS || '').length,
      port: process.env.MAIL_PORT || null,
      from: process.env.MAIL_FROM || null,
    },
  });
});

app.use(express.static(ROOT, { index: 'index.html', fallthrough: true, etag: true, maxAge: 0 }));

app.use((req, res) => res.status(404).json({ error: 'not_found' }));

app.listen(PORT, async () => {
  try {
    await db.initSchema();
    const seed = require('./seed');
    const temp = await seed.ensureAdminAccount();
    if (temp) {
      console.log('');
      console.log('==============================================================');
      console.log('  أول تشغيل: حُسوب المدير جاهز');
      console.log('  البريد: admin@nibras.local');
      console.log('  كلمة المرور المؤقتة (تُعرض مرة واحدة فقط): ' + temp);
      console.log('  سيُطلب منك تعيين كلمة مرور قوية جديدة عند أول دخول.');
      console.log('==============================================================');
    }
    console.log('PostgreSQL متصل — نبراس يعمل على http://localhost:' + PORT);
  } catch (e) {
    console.error('تعذر الاتصال بقاعدة البيانات:', e.message);
    process.exit(1);
  }
});

process.on('SIGINT', () => { db.pool.end().then(() => process.exit(0)); });

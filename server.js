'use strict';
// ============================================================
// نبراس — خادم آمن (Express + PostgreSQL + جلسات حقيقية)
// الاستبدال الكامل لخادم JSON + SYNC_KEY القديم
// ============================================================
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const db = require('./db');

// قراءة متغير: من Environment أولاً، ثم من ملف سري في /etc/secrets (بديل Render)
function envOrSecret(name, fallback) {
  if (process.env[name]) return process.env[name];
  const p = '/etc/secrets/' + name;
  try {
    if (fs.existsSync(p)) {
      const v = fs.readFileSync(p, 'utf8').trim();
      if (v) return v;
    }
  } catch (_) { /* تجاهل */ }
  return fallback;
}

const ROOT = process.env.WEBROOT || path.join(__dirname, 'public');
const PORT = Number(process.env.PORT) || 8090;
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS) || 24 * 60 * 60 * 1000; // 24 ساعة
const SESSION_COOKIE = 'nibras_session';
const MAX_BODY_MB = Number(process.env.MAX_BODY_MB) || 20;
const BCRYPT_ROUNDS = 10;

// بريد استعادة الرقم السري (SMTP) — يأتي من متغيرات البيئة (لا يُحفظ في الكود)
const MAIL_HOST = envOrSecret('MAIL_HOST', '');
const MAIL_PORT = Number(envOrSecret('MAIL_PORT', '587'));
const MAIL_SECURE = Number(MAIL_PORT) === 465;
const MAIL_USER = envOrSecret('MAIL_USER', '');
const MAIL_PASS = envOrSecret('MAIL_PASS', '');
const MAIL_FROM = envOrSecret('MAIL_FROM', '') || MAIL_USER;
let mailTransporter = null;
function getMailer() {
  if (!MAIL_HOST || !MAIL_USER || !MAIL_PASS) return null;
  if (!mailTransporter) {
    mailTransporter = nodemailer.createTransport({
      host: MAIL_HOST, port: MAIL_PORT, secure: MAIL_SECURE,
      auth: { user: MAIL_USER, pass: MAIL_PASS },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
      connectionOptions: { family: 4 },
    });
  }
  return mailTransporter;
}
// إرسال عبر REST API الخاصة بـ Brevo (يعمل من Render لأن منافذ SMTP 587/465 محجوبة
// بينما api.brevo.com:443 متاحة). المفتاح يُقرأ من MAIL_PASS (xkeysib-...) أو MAIL_API_KEY.
async function sendResetEmail(toEmail, code, expiresInMin) {
  const apiKey = envOrSecret('MAIL_API_KEY', '') || (MAIL_PASS && String(MAIL_PASS).indexOf('xkeysib-') === 0 ? MAIL_PASS : '');
  if (!apiKey) return false;
  try {
    const payload = {
      sender: { email: MAIL_FROM, name: 'نظام نبراس' },
      to: [{ email: toEmail }],
      subject: 'نبراس — رمز استعادة الرقم السري',
      textContent: 'نظام نبراس\n\nرمز استعادة الرقم السري الخاص بك هو: ' + code + '\nالرمز صالح لمدة ' + expiresInMin + ' دقائق.\n\nإذا لم تطلب هذا الرمز، تجاهل هذه الرسالة.',
      htmlContent: '<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;max-width:520px;margin:auto;border:1px solid #e2e8f0;border-radius:12px;padding:24px;color:#1f2937">'
        + '<h2 style="color:#0f766e;margin:0 0 8px">نظام نبراس</h2>'
        + '<p>رمز استعادة الرقم السري الخاص بك هو:</p>'
        + '<div style="font-size:34px;font-weight:800;text-align:center;background:#f1f5f9;border-radius:8px;padding:14px;direction:ltr">' + code.split('').join('&nbsp;') + '</div>'
        + '<p>الرمز صالح لمدة <b>' + expiresInMin + ' دقائق</b>.</p>'
        + '<p style="color:#64748b;font-size:13px">إذا لم تطلب هذا الرمز، تجاهل هذه الرسالة.</p>'
        + '</div>',
    };
    const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': apiKey, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
    if (resp.status === 201 || resp.status === 200) return true;
    const detail = await resp.text().catch(() => '');
    console.error('[mail] فشل إرسال البريد عبر API:', resp.status, detail, '| to=', toEmail);
    return false;
  } catch (e) {
    console.error('[mail] فشل إرسال البريد:', e.message, '| to=', toEmail);
    return false;
  }
}

/* إرسال بريد مع مرفق (ملف Excel ببيانات الدخول) عبر Brevo REST API */
async function sendMailAttachment(toEmail, subject, html, filename, base64Content) {
  const apiKey = envOrSecret('MAIL_API_KEY', '') || (MAIL_PASS && String(MAIL_PASS).indexOf('xkeysib-') === 0 ? MAIL_PASS : '');
  if (!apiKey || !base64Content) return false;
  try {
    const mime = String(filename).toLowerCase().endsWith('.xlsx')
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'application/octet-stream';
    const payload = {
      sender: { email: MAIL_FROM, name: 'نظام نبراس' },
      to: [{ email: toEmail }],
      subject,
      textContent: 'نظام نبراس\n\nالمرفق يحتوي بيانات دخول المعلمين (أسماء المستخدمين وكلمات المرور المؤقتة).\nأبلغ كل معلم باسم المستخدم وكلمة المرور، وسيُطلب منه تغييرها عند أول دخول.',
      htmlContent: '<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;max-width:520px;margin:auto;border:1px solid #e2e8f0;border-radius:12px;padding:24px;color:#1f2937">'
        + '<h2 style="color:#0f766e;margin:0 0 8px">نظام نبراس</h2>'
        + '<p>المرفق يحتوي <b>بيانات دخول المعلمين</b> (أسماء المستخدمين وكلمات المرور المؤقتة).</p>'
        + '<p>أبلغ كل معلم باسم المستخدم وكلمة المرور الخاصين به، وسيُطلب منه تغيير كلمة المرور وتعيين بريده الحقيقي عند أول دخول.</p>'
        + '<p style="color:#64748b;font-size:13px">لا تُرَد هذه الرسالة — إن لم تطلبها، تجاهلها وأبلغ مسؤول النظام.</p>'
        + '</div>',
      attachment: [{ name: String(filename).slice(0, 120), content: base64Content, type: mime }],
    };
    const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': apiKey, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000),
    });
    if (resp.status === 201 || resp.status === 200) return true;
    const detail = await resp.text().catch(() => '');
    console.error('[mail] فشل إرسال البريد مع المرفق:', resp.status, detail, '| to=', toEmail);
    return false;
  } catch (e) {
    console.error('[mail] فشل إرسال البريد مع المرفق:', e.message, '| to=', toEmail);
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
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' https://api.open-meteo.com; frame-src 'self' https://*.sharepoint.com https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com");
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
function sendUser(u, sessionRow, viewerRole) {
  const user = { id: u.id, school: u.school, name: u.name, username: u.username, email: u.email, role: u.role, active: u.active, firstLogin: u.first_login, granted: u.granted !== false, ...(u.data || {}) };
  if (viewerRole === 'ADMIN' && u.plain_password) user.plain_password = u.plain_password;
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
    const login = String(req.body && (req.body.login || req.body.email) || '').trim().toLowerCase();
    const password = String(req.body && req.body.password || '');
    if (!login || !password) return res.status(400).json({ error: 'missing' });
    // الدخول يكون باسم المستخدم (username)، مع بقاء دعم البريد الإلكتروني كبديل (يحتوي @)
    let candidates;
    if (login.includes('@')) candidates = await db.usersByEmail(login);
    else { const single = await db.userByUsername(login); candidates = single ? [single] : []; }
    let u = null;
    for (const c of candidates) {
      if (!c.active) continue;
      const ok = await bcrypt.compare(password, c.password_hash);
      if (ok) { u = c; break; }
    }
    if (!u) { fails.count++; return res.status(401).json({ error: 'invalid' }); }
    // القيد الصارم: الدخول مسموح فقط للحسابات المُصدَّرة بيانات دخولها أو المضافة يدويًا من المدير
    if (u.role !== 'ADMIN' && u.granted !== true) {
      fails.count++;
      return res.status(403).json({ error: 'not_granted' });
    }
    fails.count = 0;

    // إنهاء الدخول برحلة واحدة: حذف الجلسات القديمة + إنشاء الجلسة + إحصاءات الدخول
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const nowMs = Date.now();
    const lastLoginIso = new Date(nowMs).toISOString();
    const hist = Array.isArray(u.data.loginHistory) ? u.data.loginHistory.slice(-299) : [];
    hist.push(lastLoginIso);
    const loginCount = (u.data.loginCount || 0) + 1;
    const row = await db.finalizeLogin(
      u.id, u.school, tokenHash, SESSION_TTL_MS, req.ip, (req.headers['user-agent'] || '').slice(0, 250),
      Object.assign({}, u.data, { lastLogin: lastLoginIso, loginCount, loginHistory: hist }),
      loginCount, lastLoginIso, hist);

    req._sessionToken = token;
    res.setHeader('Set-Cookie', cookieOpts(req));
    res.json({ ok: true, user: sendUser(u, row || { created_at: lastLoginIso, expires_at: new Date(nowMs + SESSION_TTL_MS).toISOString() }, u.role) });
  })().catch(fail(res));
});

/* ============ الدخول السريع أُلغي ============ */

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
    res.json({ ok: true, user: sendUser(u, s, u.role) });
  }).catch(fail(res));
});

app.post('/api/auth/change-password', requireAuth, (req, res) => {
  (async () => {
    if (rateLimit('chpwd', 6, 15 * 60 * 1000, req)) return res.status(429).json({ error: 'rate_limited' });
    const pw = String(req.body && req.body.newPassword || '');
    if (pw && !PASSWORD_RE.test(pw)) return res.status(400).json({ error: 'weak_password', min: PASSWORD_MIN });
    const me = await db.userById(req.session.user_id);
    if (!me) return res.status(401).json({ error: 'unauthorized' });
    const email = String(req.body && req.body.email || '').trim().toLowerCase();
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'bad_email' });
    // كل التحقق نجح — نطبّق التغييرات (كلمة المرور اختيارية ثم البريد)
    if (pw) {
      const hash = await bcrypt.hash(pw, BCRYPT_ROUNDS);
      await db.updateUserPasswordHash(me.id, hash, false);
      await db.updateUserPlainPassword(me.id, pw);
    }
    const after = await db.userById(me.id);
    if (email) {
      await db.insertUser(Object.assign({}, after, { email }));
      await updateSchoolUser(req.session.school, me.id, { email });
    }
    await updateSchoolUser(req.session.school, me.id, { firstLogin: false });
    const u = await db.userById(me.id);
    res.json({ ok: true, user: sendUser(u, req.session, req.session.role) });
  })().catch(fail(res));
});

app.post('/api/auth/update-profile', requireAuth, (req, res) => {
  (async () => {
    if (rateLimit('profile', 12, 15 * 60 * 1000, req)) return res.status(429).json({ error: 'rate_limited' });
    let u = await db.userById(req.session.user_id);
    if (!u) return res.status(401).json({ error: 'unauthorized' });

    const email = String(req.body && req.body.email || '').trim().toLowerCase();
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'bad_email' });
    const pw = String(req.body && req.body.newPassword || '');
    if (pw) {
      if (!PASSWORD_RE.test(pw)) return res.status(400).json({ error: 'weak_password', min: PASSWORD_MIN });
      const hash = await bcrypt.hash(pw, BCRYPT_ROUNDS);
      await db.updateUserPasswordHash(u.id, hash, false);
      await db.updateUserPlainPassword(u.id, pw);
      await updateSchoolUser(u.school, u.id, { firstLogin: false });
      u = await db.userById(u.id);
    }
    if (email) {
      await db.insertUser(Object.assign({}, u, { email }));
      await updateSchoolUser(u.school, u.id, { email });
    }
    const updated = await db.userById(u.id);
    res.json({ ok: true, user: sendUser(updated, req.session, req.session.role) });
  })().catch(fail(res));
});

/* ============ استعادة كلمة المرور (رمز يظهر على الشاشة — لا خدمة إيميل) ============ */
const RESET_CODE_TTL_MS = 10 * 60 * 1000;
app.post('/api/auth/forgot-password', (req, res) => {
  (async () => {
    if (rateLimit('forgot', 5, 15 * 60 * 1000, req)) return res.status(429).json({ error: 'rate_limited' });
    const login = String(req.body && (req.body.email || req.body.login) || '').trim().toLowerCase();
    if (!login) return res.status(400).json({ error: 'missing' });
    // الدخول بالاسم أو البريد: الاسم فريد فلا لبس في تحديد الحساب المستهدف (البريد قد يتكرر)
    let candidates;
    if (login.includes('@')) candidates = await db.usersByEmail(login);
    else { const single = await db.userByUsername(login); candidates = single ? [single] : []; }
    if (!candidates.length) return res.status(404).json({ error: 'not_found' });
    const active = candidates.filter(c => c.active);
    if (!active.length) return res.status(404).json({ error: 'not_found' });
    const u = active[0];
    const code = String(Math.floor(100000 + Math.random() * 900000));
    for (const c of active) {
      await db.updateUserProfile(c.id, { data: Object.assign({}, c.data, { resetCode: code, resetExpires: Date.now() + RESET_CODE_TTL_MS }) });
    }
    // اسم/أسماء الحسابات المطابقة ليظهر للمستخدم قبل تطبيق الرمز (يتجنب تغيير حساب خاطئ)
    const names = active.map(c => c.name);
    // البريد الافتراضي للأنظمة (مثل @nibras.local أو @school.local) غير قابل للاستلام الفعلي:
    // نعرض الرمز على الشاشة مباشرة بدل محاولة إرسال إلى عنوان غير موجود.
    const FAKE_DOMAINS = /@(nibras|school|local|example|test)(\.|$)/i;
    if (FAKE_DOMAINS.test(u.email)) {
      return res.json({ ok: true, code, expiresInMin: 10, fallback: true, names });
    }
    // إرسال الرمز إلى بريد المستخدم عبر SMTP (nassser8@gmail.com). إن لم يُضبط البريد: نعرضه في الاستجابة (وضع التطوير).
    const sent = await sendResetEmail(u.email, code, Math.round(RESET_CODE_TTL_MS / 60000));
    res.json(sent ? { ok: true, expiresInMin: 10, names } : { ok: true, code, expiresInMin: 10, fallback: true, names });
  })().catch(fail(res));
});

app.post('/api/auth/recover-password', (req, res) => {
  (async () => {
    if (rateLimit('recover', 8, 15 * 60 * 1000, req)) return res.status(429).json({ error: 'rate_limited' });
    const login = String(req.body && (req.body.email || req.body.login) || '').trim().toLowerCase();
    const code = String(req.body && req.body.code || '').trim();
    const pw = String(req.body && req.body.newPassword || '');
    if (!login || !code || !pw) return res.status(400).json({ error: 'missing' });
    let candidates;
    if (login.includes('@')) candidates = await db.usersByEmail(login);
    else { const single = await db.userByUsername(login); candidates = single ? [single] : []; }
    let u = candidates.find(c => c.active && c.data && String(c.data.resetCode) === code);
    if (!u) return res.status(400).json({ error: 'bad_code' });
    const exp = u.data && u.data.resetExpires;
    if (!exp || exp < Date.now()) return res.status(400).json({ error: 'code_expired' });
    if (!PASSWORD_RE.test(pw)) return res.status(400).json({ error: 'weak_password', min: PASSWORD_MIN });
    const hash = await bcrypt.hash(pw, BCRYPT_ROUNDS);
    await db.updateUserPasswordHash(u.id, hash, false);
    await db.updateUserPlainPassword(u.id, pw);
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
  if (actor.role === 'ADMIN') return ['ADMIN','AGENT','COUNSELOR','TEACHER','ADMINISTRATIVE','STUDENT'].includes(role);
  return ['COUNSELOR','TEACHER'].includes(role);
}

app.post('/api/auth/admin/create-user', requireAuth, (req, res) => {
  (async () => {
    if (rateLimit('create', 60, 15 * 60 * 1000, req)) return res.status(429).json({ error: 'rate_limited' });
    const reqSchool = String(req.body && req.body.school || '').toUpperCase();
    const school = (reqSchool === 'BOYS' || reqSchool === 'GIRLS') ? reqSchool : req.session.school;
    if (!canManageUsers(req.session, school)) return res.status(403).json({ error: 'forbidden' });
    const name = String(req.body && req.body.name || '').trim();
    const email = String(req.body && req.body.email || '').trim().toLowerCase();
    const pw = String(req.body && req.body.password || '');
    const role = String(req.body && req.body.role || '').toUpperCase();
    const isStudent = role === 'STUDENT';
    const studentId = req.body && req.body.studentId;
    if (!name || !PASSWORD_RE.test(pw) || !validRoleFor(req.session, role))
      return res.status(400).json({ error: 'invalid', min: PASSWORD_MIN });
    if (!isStudent && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
      return res.status(400).json({ error: 'invalid_email' });
    const hash = await bcrypt.hash(pw, BCRYPT_ROUNDS);
    const id = studentId || ('id_' + crypto.randomBytes(6).toString('hex'));
    const preferred = String(req.body && req.body.username || '').trim();
    const username = await db.generateUsername(name, preferred || (isStudent ? name.replace(/\s+/g, '') : email.split('@')[0]));
    const finalEmail = isStudent ? (email || (username + '@nibras.school')) : email;
    await db.insertUser({ id, school, name, email: finalEmail, username, password_hash: hash, plain_password: pw, role, active: true, first_login: !isStudent, granted: true, data: {} });
    const created = await db.userById(id);
    await appendSchoolUser(school, sendUser(created, null, 'ADMIN'));
    res.json({ ok: true, user: sendUser(created, null, 'ADMIN') });
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
    await db.updateUserPlainPassword(target.id, temp);
    await db.grantUserAccess(target.id);
    await updateSchoolUser(target.school, target.id, { firstLogin: true, granted: true });
    await db.deleteUserSessions(target.id); // إنهاء جلسات المستخدم فورًا
    res.json({ ok: true, userId: target.id, name: target.name, tempPassword: temp, firstLogin: true });
  })().catch(fail(res));
});

// توليد كلمة مرور مؤقتة جديدة لكل معلم وإرجاع قائمة (الاسم، اسم المستخدم، كلمة المرور) ليتسلمها المدير
app.post('/api/auth/admin/export-credentials', requireAuth, (req, res) => {
  (async () => {
    if (req.session.role !== 'ADMIN') return res.status(403).json({ error: 'forbidden' });
    if (rateLimit('export', 10, 60 * 60 * 1000, req)) return res.status(429).json({ error: 'rate_limited' });
    const rows = await db.listAllUsers();
    const teachers = rows.filter(u => u.active !== false && u.role === 'TEACHER');
    const out = [];
    for (const u of teachers) {
      const temp = crypto.randomBytes(6).toString('hex').slice(0, 10);
      const hash = await bcrypt.hash(temp, BCRYPT_ROUNDS);
      await db.updateUserPasswordHash(u.id, hash, true);
      await db.updateUserPlainPassword(u.id, temp);
      await db.grantUserAccess(u.id);
      await updateSchoolUser(u.school, u.id, { firstLogin: true, granted: true });
      await db.deleteUserSessions(u.id);
      out.push({ id: u.id, name: u.name, username: u.username, email: u.email, role: u.role, school: u.school, tempPassword: temp });
    }
    res.json({ ok: true, count: out.length, credentials: out });
  })().catch(fail(res));
});

// عرض الرقم السري الحقيقي لأي حساب (المدير فقط) — يعتمد على plain_password المخزّن نصيًا
app.post('/api/auth/admin/show-password', requireAuth, (req, res) => {
  (async () => {
    if (req.session.role !== 'ADMIN') return res.status(403).json({ error: 'forbidden' });
    if (rateLimit('showpw', 30, 15 * 60 * 1000, req)) return res.status(429).json({ error: 'rate_limited' });
    const userId = String(req.body && req.body.userId || '');
    const target = await db.userById(userId);
    if (!target) return res.status(404).json({ error: 'not_found' });
    if (!canManageUsers(req.session, target.school)) return res.status(403).json({ error: 'forbidden' });
    const hashed = !!(target.password_hash);
    res.json({
      ok: true,
      userId: target.id,
      name: target.name,
      username: target.username,
      email: target.email,
      role: target.role,
      school: target.school,
      plainPassword: target.plain_password || '',
      hashed,
      message: target.plain_password ? '' : (hashed ? 'مشفّرة' : 'لا يوجد رقم سري'),
    });
  })().catch(fail(res));
});

// استلام ملف Excel (base64) من المتصفح وإرساله إلى بريد المدير عبر Brevo
app.post('/api/auth/admin/mail-credentials', requireAuth, (req, res) => {
  (async () => {
    if (req.session.role !== 'ADMIN') return res.status(403).json({ error: 'forbidden' });
    if (rateLimit('mailcreds', 10, 60 * 60 * 1000, req)) return res.status(429).json({ error: 'rate_limited' });
    const filename = String(req.body && req.body.filename || 'بيانات الدخول.xlsx').slice(0, 120);
    const b64 = String(req.body && req.body.file || '');
    if (!b64) return res.status(400).json({ error: 'missing' });
    const me = await db.userById(req.session.user_id);
    const myEmail = (me && me.email) || '';
    const to = /@(nibras|school|local|example|test)/i.test(myEmail)
      ? (process.env.ADMIN_NOTIFY_EMAIL || 'nassser8@gmail.com')
      : myEmail;
    const sent = await sendMailAttachment(to, 'نبراس — بيانات دخول المعلمين',
      '<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;max-width:520px;margin:auto;border:1px solid #e2e8f0;border-radius:12px;padding:24px;color:#1f2937">'
      + '<h2 style="color:#0f766e;margin:0 0 8px">نظام نبراس</h2>'
      + '<p>المرفق يحتوي <b>بيانات دخول المعلمين</b> (أسماء المستخدمين وكلمات المرور المؤقتة).</p>'
      + '<p>أبلغ كل معلم باسم المستخدم وكلمة المرور الخاصين به، وسيُطلب منه تغيير كلمة المرور وتعيين بريده الحقيقي عند أول دخول.</p>'
      + '<p style="color:#64748b;font-size:13px">إن لم تطلب هذا الملف، تجاهل الرسالة.</p>'
      + '</div>', filename, b64);
    res.json(sent ? { ok: true, emailedTo: to } : { ok: false, error: 'mail_failed', emailedTo: to });
  })().catch(fail(res));
});

/* ================= قائمة الحسابات للدخول (بلا أي كلمات مرور) ================= */
app.get('/api/auth/accounts', (req, res) => {
  db.listAllUsers().then(rows => {
    const accounts = rows
      .filter(u => u.active !== false)
      .map(u => ({ name: u.name, username: u.username, email: u.email, role: u.role, school: u.school }));
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
    if (n.email && tbl.email !== n.email) await db.updateUserIdentity(p.id, { email: n.email });
    if (n.name && tbl.name !== n.name) await db.updateUserIdentity(p.id, { name: n.name });
  }
  // مستخدم جديد في بيانات هذا القسم (مثلاً منقول إليه): إعادة تفعيل حسابه وتصحيح قسمه
  for (const n of (nextUsers || [])) {
    if (prevMap.has(n.id)) continue;
    const tbl = await db.userById(n.id);
    if (!tbl) continue;
    await db.setUserSchool(n.id, school);
    await db.setUserActive(n.id, n.active !== false);
    if (n.email && tbl.email !== n.email) await db.updateUserIdentity(n.id, { email: n.email });
  }
}

app.get('/api/db/:school', requireAuth, (req, res) => {
  (async () => {
    const school = String(req.params.school).toUpperCase();
    if (!db.SCHOOLS.includes(school)) return res.status(400).json({ error: 'bad_school' });
    if (!schoolAccess(req.session, school)) return res.status(403).json({ error: 'forbidden' });
    const rec = await db.getSchoolData(school);
    if (!rec.data) return res.json({ ts: 0, data: null });
    // احقن إحصاءات الدخول الموثوقة من جدول الحسابات (مصدر الحقيقة) في نسخة القسم،
    // حتى لو اختلفت معرّفات/إحصاءات local storage لدى المتصفحات. المطابقة بالمعرّف ثم باسم المستخدم.
    if (Array.isArray(rec.data.users) && rec.data.users.length) {
      const stats = await db.usersForLoginStats(school);
      const byId = new Map();
      const byLower = new Map();
      for (const t of stats) {
        byId.set(t.id, t);
        if (t.username) byLower.set(String(t.username).toLowerCase(), t);
      }
      const overlay = (u, t) => {
        const d = t.data || {};
        // حقن إحصاءات الدخول الفعلية فقط (دخول حقيقي مسجّل)، لا نلمس العلم ولا المعرّف
        if (!d) return;
        const hasLogin = !!d.lastLogin || (d.loginCount || 0) > 0;
        if (!hasLogin) return;
        if (d.lastLogin) u.lastLogin = d.lastLogin;
        if (d.loginCount) u.loginCount = d.loginCount;
        if (Array.isArray(d.loginHistory)) u.loginHistory = d.loginHistory;
      };
      const seen = new Set();
      rec.data.users = rec.data.users.map(u => {
        const t = byId.get(u.id) || (u.username ? byLower.get(String(u.username).toLowerCase()) : null);
        if (t) { seen.add(t.id); overlay(u, t); }
        return u;
      });
    }
    res.json({ ts: rec.ts, data: rec.data });
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

    // تنظيف دفاعي: لا تُخزن أي بيانات اعتماد في نسخة البيانات + حقن أسماء المستخدمين الحالية حتى لا تضيع
    const clean = JSON.parse(JSON.stringify(data));
    if (Array.isArray(clean.users) && clean.users.length) {
      const uidSet = new Set(clean.users.map(u => u.id));
      const unameMap = await db.usernamesByIds([...uidSet]);
      clean.users.forEach(u => { if (unameMap.has(u.id)) u.username = unameMap.get(u.id); });
      clean.users.forEach(u => STRIP_FIELDS.forEach(f => delete u[f]));
    }
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
const net = require('net');
function tcpTest(host, port, ms) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port, family: 4, timeout: ms });
    const done = (ok, why) => { try { s.destroy(); } catch (_) {} resolve(ok ? 'OK' : 'FAIL ' + why); };
    s.on('connect', () => done(true, ''));
    s.on('timeout', () => done(false, 'timeout'));
    s.on('error', (e) => done(false, e.code || e.message));
  });
}
app.get('/api/health', (req, res) => {
  res.json({
    ok: true, schools: db.SCHOOLS, db: 'postgres',
    mail: {
      host: !!MAIL_HOST,
      user: !!MAIL_USER,
      pass: !!MAIL_PASS,
      passLen: (MAIL_PASS || '').length,
      port: MAIL_PORT,
      from: MAIL_FROM || null,
    },
  });
});
app.get('/api/diag/smtp', async (req, res) => {  const targets = [
    ['smtp.gmail.com', 587], ['smtp.gmail.com', 465],
    ['smtp.gmail.com', 25], ['142.251.127.108', 587],
    ['smtp-relay.brevo.com', 587], ['smtp-relay.brevo.com', 465], ['smtp-relay.brevo.com', 25],
    ['www.google.com', 443], ['example.com', 80],
    ['api.brevo.com', 443], ['app.brevo.com', 443], ['smtp-relay.brevo.com', 443],
  ];
  const out = [];
  for (const [h, p] of targets) {
    out.push(h + ':' + p + ' => ' + await tcpTest(h, p, 8000));
  }
  res.json({ targets: out });
});
app.get('/api/diag/mail', async (req, res) => {
  try {
    const apiKey = envOrSecret('MAIL_API_KEY', '') || (MAIL_PASS && String(MAIL_PASS).indexOf('xkeysib-') === 0 ? MAIL_PASS : '');
    const sent = await sendResetEmail('nassser8@gmail.com', 'TEST' + Date.now() % 100000, 10);
    res.json({ sent, host: MAIL_HOST, port: MAIL_PORT, user: MAIL_USER, from: MAIL_FROM, passLen: (MAIL_PASS || '').length, apiKeyLen: (apiKey || '').length, apiKeyPrefix: String(apiKey || '').slice(0, 12) });
  } catch (e) {
    res.json({ error: e.message, stack: String(e && e.stack || '').split('\n').slice(0, 6) });
  }
});
app.get('/api/diag/db', async (req, res) => {
  try {
    const r = await db.pool.query('SELECT current_database() AS db, current_user AS usr, (SELECT count(*) FROM users) AS users');
    res.json(r.rows[0]);
  } catch (e) {
    res.json({ error: e.message });
  }
});

app.use(express.static(ROOT, { index: 'index.html', fallthrough: true, etag: true, maxAge: 0 }));

app.use((req, res) => res.status(404).json({ error: 'not_found' }));

// إبقاء المثيل نشطًا على خطة Render المجانية (ينام بعد 15 دقيقة خمول فيبرد أول دخول)
if (process.env.RENDER && process.env.PING_URL_DISABLED !== '1') {
  const pingUrl = process.env.PING_URL || 'https://https-nibras-school-netlify-app-1.onrender.com';
  setInterval(() => { fetch(pingUrl + '/api/health').catch(() => {}); }, 4 * 60 * 1000).unref();
}

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

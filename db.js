'use strict';
// نبراس — طبقة قاعدة البيانات (PostgreSQL)
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:Nibras@Postgres_2026@127.0.0.1:5432/nibras';

const pool = new Pool({ connectionString: DATABASE_URL, max: 10 });

const SCHOOLS = ['BOYS', 'GIRLS'];

async function initSchema() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id            TEXT PRIMARY KEY,
        school        TEXT NOT NULL CHECK (school IN ('BOYS','GIRLS')),
        name          TEXT NOT NULL,
        email         TEXT NOT NULL,
        username      TEXT,
        password_hash TEXT NOT NULL,
        role          TEXT NOT NULL CHECK (role IN ('ADMIN','AGENT','COUNSELOR','TEACHER','ADMINISTRATIVE')),
        active        BOOLEAN NOT NULL DEFAULT true,
        first_login   BOOLEAN NOT NULL DEFAULT false,
        data          JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS users_username_key ON users(username)`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        school     TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at TIMESTAMPTZ NOT NULL,
        ip         TEXT,
        user_agent TEXT
      )`);
    await client.query(`
      CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id)`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS school_data (
        school     TEXT PRIMARY KEY CHECK (school IN ('BOYS','GIRLS')),
        data       JSONB NOT NULL DEFAULT '{}'::jsonb,
        ts         BIGINT NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/* ===== المستخدمون ===== */
async function userByEmail(email) {
  const r = await pool.query('SELECT * FROM users WHERE email = $1', [String(email || '').toLowerCase().trim()]);
  return r.rows[0] || null;
}
async function usersByEmail(email) {
  const r = await pool.query('SELECT * FROM users WHERE email = $1', [String(email || '').toLowerCase().trim()]);
  return r.rows;
}
async function userByUsername(username) {
  const r = await pool.query('SELECT * FROM users WHERE username = $1', [String(username || '').trim().toLowerCase()]);
  return r.rows[0] || null;
}
async function usernameExists(username) {
  const r = await pool.query('SELECT 1 FROM users WHERE username = $1', [String(username || '').trim().toLowerCase()]);
  return r.rows.length > 0;
}
// تحويل الاسم العربي إلى اسم مستخدم لاتيني بسيط (للحصول على قيمة فريدة تُستخدم للدخول)
const AR2LAT = {
  'ا':'a','أ':'a','إ':'a','آ':'a','ٱ':'a','ب':'b','ت':'t','ث':'th','ج':'j','ح':'h','خ':'kh',
  'د':'d','ذ':'dh','ر':'r','ز':'z','س':'s','ش':'sh','ص':'s','ض':'d','ط':'t','ظ':'z',
  'ع':'a','غ':'gh','ف':'f','ق':'q','ك':'k','ل':'l','م':'m','ن':'n','ه':'h','و':'w','ي':'y',
  'ة':'h','ى':'a','ء':'' , 'ؤ':'w','ئ':'y'
};
function baseUsername(name) {
  let s = String(name || '');
  s = s.replace(/[\u064B-\u0652\u0670\u0640]/g, ''); // التشكيل
  let out = '';
  for (const ch of s) {
    if (AR2LAT[ch]) out += AR2LAT[ch];
    else if (/[a-zA-Z0-9]/.test(ch)) out += ch.toLowerCase();
    // أي حرف آخر (مسافات، رموز) يُتجاهل
  }
  if (!out) out = 'user';
  out = out.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
  if (!out) out = 'user';
  return out.slice(0, 24);
}
async function generateUsername(name, preferred) {
  const base = baseUsername(preferred && String(preferred).trim() ? preferred : name);
  let candidate = base;
  let i = 1;
  while (await usernameExists(candidate)) { i++; candidate = base + i; }
  return candidate;
}
async function generateUsernameUnique(name, existingUsernames) {
  const base = baseUsername(name);
  let candidate = base;
  let i = 1;
  while ((existingUsernames && existingUsernames.has(candidate)) || await usernameExists(candidate)) { i++; candidate = base + i; }
  return candidate;
}
async function userById(id) {
  const r = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return r.rows[0] || null;
}
async function listUsers(school) {
  const r = await pool.query('SELECT * FROM users WHERE school = $1 ORDER BY name', [school]);
  return r.rows;
}
async function listAllUsers() {
  const r = await pool.query('SELECT id, school, name, email, username, role, active, first_login FROM users ORDER BY school, role, name');
  return r.rows;
}
async function usernamesByIds(ids) {
  const r = await pool.query('SELECT id, username FROM users WHERE id = ANY($1::text[]) AND username IS NOT NULL', [ids]);
  const m = new Map();
  r.rows.forEach(x => m.set(x.id, x.username));
  return m;
}
async function countAdmins() {
  const r = await pool.query(`SELECT count(*)::int AS n FROM users WHERE role = 'ADMIN'`);
  return r.rows[0] ? r.rows[0].n : 0;
}
async function insertUser(u) {
  await pool.query(
    `INSERT INTO users (id, school, name, email, username, password_hash, role, active, first_login, data)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (id) DO UPDATE SET
       name=EXCLUDED.name, email=EXCLUDED.email, username=EXCLUDED.username,
       password_hash=EXCLUDED.password_hash,
       role=EXCLUDED.role, active=EXCLUDED.active, first_login=EXCLUDED.first_login, data=EXCLUDED.data`,
    [u.id, u.school, u.name, String(u.email).toLowerCase().trim(), u.username ? String(u.username).trim().toLowerCase() : null,
     u.password_hash, u.role, u.active !== false, !!u.first_login, JSON.stringify(u.data || {})]);
}
async function updateUserPasswordHash(id, hash, firstLogin) {
  await pool.query('UPDATE users SET password_hash=$2, first_login=$3 WHERE id=$1',
    [id, hash, firstLogin !== false]);
}
async function updateUserProfile(id, fields) {
  const data = JSON.stringify(fields.data || {});
  await pool.query('UPDATE users SET data=$2::jsonb WHERE id=$1', [id, data]);
}
async function setUserActive(id, active) {
  await pool.query('UPDATE users SET active=$2 WHERE id=$1', [id, active !== false]);
}
async function deactivateUser(id) { await setUserActive(id, false); }
async function setUserSchool(id, school) {
  await pool.query('UPDATE users SET school=$2 WHERE id=$1', [id, school]);
}
async function updateUserIdentity(id, fields) {
  const sets = [];
  const vals = [id];
  if (fields.name !== undefined) { sets.push('name=$' + (vals.length + 1)); vals.push(fields.name); }
  if (fields.email !== undefined) { sets.push('email=$' + (vals.length + 1)); vals.push(String(fields.email).toLowerCase().trim()); }
  if (fields.username !== undefined) { sets.push('username=$' + (vals.length + 1)); vals.push(String(fields.username).trim().toLowerCase()); }
  if (!sets.length) return;
  await pool.query('UPDATE users SET ' + sets.join(', ') + ' WHERE id=$1', vals);
}
async function setUserUsername(id, username) {
  await pool.query('UPDATE users SET username=$2 WHERE id=$1', [id, String(username || '').trim().toLowerCase()]);
}

/* ===== الجلسات ===== */
async function createSession(userId, school, tokenHash, ttlMs, ip, ua) {
  await pool.query(
    `INSERT INTO sessions (token_hash, user_id, school, expires_at, ip, user_agent)
     VALUES ($1,$2,$3, now() + ($4::float/1000 || ' seconds')::interval, $5, $6)`,
    [tokenHash, userId, school, ttlMs, ip, ua]);
}
async function sessionByTokenHash(tokenHash) {
  const r = await pool.query(
    `SELECT s.*, u.name, u.role, u.active, u.first_login, u.data
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now() AND u.active = true`, [tokenHash]);
  return r.rows[0] || null;
}
async function deleteSession(tokenHash) {
  await pool.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
}
async function deleteUserSessions(userId) {
  await pool.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
}
async function sweepSessions() {
  await pool.query('DELETE FROM sessions WHERE expires_at <= now()');
}

/* ===== بيانات الأقسام ===== */
async function getSchoolData(school) {
  const r = await pool.query('SELECT data, ts FROM school_data WHERE school = $1', [school]);
  if (!r.rows.length) return { data: null, ts: 0 };
  return { data: r.rows[0].data, ts: Number(r.rows[0].ts) || 0 };
}
async function setSchoolData(school, data, ts) {
  await pool.query(
    `INSERT INTO school_data (school, data, ts, updated_at)
     VALUES ($1,$2,$3, now())
     ON CONFLICT (school) DO UPDATE SET data=EXCLUDED.data, ts=EXCLUDED.ts, updated_at=now()`,
    [school, JSON.stringify(data), ts]);
}
// تحديث إحصاءات الدخول داخل نسخة القسم (school_data.users) بتعديل جزئي على الخادم
// دون نقل ملف البيانات الكامل (348KB) إلى العميل — أسرع بكثير في كل دخول.
async function patchSchoolUserStats(school, userId, lastLoginIso, loginCount, historyJsonArray) {
  await pool.query(
    `UPDATE school_data
        SET data = jsonb_set(data, '{users}', (
          SELECT COALESCE(jsonb_agg(
            CASE WHEN elem->>'id' = $1
                 THEN elem || jsonb_build_object(
                        'lastLogin', to_jsonb($2::text),
                        'loginCount', to_jsonb($3::int),
                        'loginHistory', COALESCE($4::jsonb, '[]'::jsonb))
                 ELSE elem END), '[]'::jsonb)
          FROM jsonb_array_elements(data->'users') elem
        ), false)
      WHERE school = $5`,
    [userId, lastLoginIso, loginCount, JSON.stringify(historyJsonArray), school]);
}

module.exports = {
  pool, SCHOOLS,
  initSchema,
  userByEmail, usersByEmail, userByUsername, usernameExists, generateUsername, baseUsername,
  userById, listUsers, listAllUsers, usernamesByIds, countAdmins, insertUser,
  updateUserPasswordHash, updateUserProfile,
  setUserActive, deactivateUser, setUserSchool, updateUserIdentity, setUserUsername,
  createSession, sessionByTokenHash, deleteSession, deleteUserSessions, sweepSessions,
  getSchoolData, setSchoolData, patchSchoolUserStats,
};

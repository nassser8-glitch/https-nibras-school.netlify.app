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
        email         TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role          TEXT NOT NULL CHECK (role IN ('ADMIN','AGENT','COUNSELOR','TEACHER','ADMINISTRATIVE')),
        active        BOOLEAN NOT NULL DEFAULT true,
        first_login   BOOLEAN NOT NULL DEFAULT false,
        data          JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
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
async function userById(id) {
  const r = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return r.rows[0] || null;
}
async function listUsers(school) {
  const r = await pool.query('SELECT * FROM users WHERE school = $1 ORDER BY name', [school]);
  return r.rows;
}
async function listAllUsers() {
  const r = await pool.query('SELECT id, school, name, email, role, active, first_login FROM users ORDER BY school, role, name');
  return r.rows;
}
async function countAdmins() {
  const r = await pool.query(`SELECT count(*)::int AS n FROM users WHERE role = 'ADMIN'`);
  return r.rows[0] ? r.rows[0].n : 0;
}
async function insertUser(u) {
  await pool.query(
    `INSERT INTO users (id, school, name, email, password_hash, role, active, first_login, data)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (id) DO UPDATE SET
       name=EXCLUDED.name, email=EXCLUDED.email, password_hash=EXCLUDED.password_hash,
       role=EXCLUDED.role, active=EXCLUDED.active, first_login=EXCLUDED.first_login, data=EXCLUDED.data`,
    [u.id, u.school, u.name, String(u.email).toLowerCase().trim(), u.password_hash, u.role,
     u.active !== false, !!u.first_login, JSON.stringify(u.data || {})]);
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
  if (!sets.length) return;
  await pool.query('UPDATE users SET ' + sets.join(', ') + ' WHERE id=$1', vals);
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

module.exports = {
  pool, SCHOOLS,
  initSchema,
  userByEmail, userById, listUsers, listAllUsers, countAdmins, insertUser,
  updateUserPasswordHash, updateUserProfile,
  setUserActive, deactivateUser, setUserSchool, updateUserIdentity,
  createSession, sessionByTokenHash, deleteSession, deleteUserSessions, sweepSessions,
  getSchoolData, setSchoolData,
};

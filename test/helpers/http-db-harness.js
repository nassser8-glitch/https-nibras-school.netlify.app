'use strict';
const path = require('path');
const fixture = JSON.parse(process.env.HTTP_TEST_FIXTURE || '{}');
const data = fixture.data || {};
const sessionsFile = process.env.HTTP_TEST_SESSIONS_FILE;
const stateFile = process.env.HTTP_TEST_STATE_FILE;
const readJson = (file, fallback) => {
  try { return JSON.parse(require('fs').readFileSync(file, 'utf8')); } catch (_) { return fallback; }
};
const writeJson = (file, value) => {
  try { require('fs').writeFileSync(file, JSON.stringify(value)); } catch (_) {}
};
const clone = value => value === undefined ? value : JSON.parse(JSON.stringify(value));
const publish = () => writeJson(stateFile, clone(data));

const dbStub = {
  SCHOOLS: ['GIRLS'],
  async initSchema() { return true; },
  async getSchoolData() { return { data: clone(data), ts: 1 }; },
  async setSchoolData(_school, next) {
    for (const key of Object.keys(data)) delete data[key];
    Object.assign(data, clone(next));
    publish();
    return { written: true, ts: Date.now() };
  },
  async sessionByTokenHash(hash) { return (readJson(sessionsFile, {}) || {})[hash] || null; },
  async touchSession(hash, ttlMs) {
    const all = readJson(sessionsFile, {}) || {};
    if (!all[hash]) return null;
    all[hash].expires_at = new Date(Date.now() + (ttlMs || 864e5)).toISOString();
    writeJson(sessionsFile, all);
    return all[hash].expires_at;
  },
  async usernamesByIds(ids) {
    return new Map((data.users || []).filter(u => ids.includes(u.id)).map(u => [u.id, u.username || u.name]));
  },
  async usersForLoginStats() { return (data.users || []).map(u => ({ id: u.id, first_login: false })); },
  async deactivateUser() { return true; },
  async deleteUser() { return true; },
  async setUserFirstLogin() { return true; },
  async updateUser() { return true; },
  async getUser() { return null; },
  async userById(id) { return (data.users || []).find(u => u.id === id) || null; },
  async userByUsername(name) { return (data.users || []).find(u => u.username === name) || null; },
  async usersByIds(ids) { return (data.users || []).filter(u => ids.includes(u.id)); },
  async normalizeTeacherDuplicates() {},
  async getAllSchoolData() { return []; },
  async saveBackup() { return true; },
  async listBackups() { return []; },
  async health() { return true; },
  pool: { query: async () => ({ rows: [] }) }
};
const dbPath = require.resolve(path.join(__dirname, '..', '..', 'db.js'));
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, path: path.dirname(dbPath), loaded: true,
  exports: new Proxy(dbStub, { get(target, key) {
    if (key in target) return target[key];
    if (typeof key === 'string') return async () => { throw new Error('unstubbed db function: ' + key); };
  } })
};
const seedPath = require.resolve(path.join(__dirname, '..', '..', 'seed.js'));
require.cache[seedPath] = {
  id: seedPath, filename: seedPath, path: path.dirname(seedPath), loaded: true,
  exports: { ensureAdminAccount: async () => null }
};
const express = require('express');
const originalListen = express.application.listen;
express.application.listen = function (...args) {
  const callback = args[args.length - 1];
  args[args.length - 1] = function () {
    return callback.apply(this, arguments);
  };
  return originalListen.apply(this, args);
};
process.on('uncaughtException', error => process.stderr.write('[uncaught] ' + error.stack + '\n'));
if (process.env.HTTP_TEST_LOG_FILE) {
  const fs = require('fs');
  const start = Date.now();
  for (const stream of [process.stdout, process.stderr]) stream.on('data', chunk => {
    try { fs.appendFileSync(process.env.HTTP_TEST_LOG_FILE, '[' + (Date.now() - start) + 'ms] ' + chunk); } catch (_) {}
  });
}

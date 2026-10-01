'use strict';
// تشغيل server.js الأصلي (Express + توجيه + جلسات + ملفات ثابتة) على منفذ حقيقي
// مع db مستبدل، مع إبقاء الاختبار في عملية منفصلة عبر ملفات (sessions + state).
// مُستخرَج من star-week-http.test.js ليستخدمه أكثر من ملف اختبار.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const HARNESS = path.join(__dirname, 'stars-http-harness.js');

const DAY_KEYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'];
function ttCell(classId, n) {
  const t = {};
  for (const d of DAY_KEYS) { t[d] = {}; for (let p = 1; p <= n; p++) t[d][p] = { classId, subject: 'رياضيات' }; }
  return t;
}

function boot(fx) {
  const tag = 'stwboot-' + process.pid + '-' + Math.random().toString(36).slice(2, 8);
  const SESSIONS_FILE = path.join(os.tmpdir(), tag + '-sessions.json');
  const STATE_FILE = path.join(os.tmpdir(), tag + '-state.json');
  const LOG_FILE = path.join(os.tmpdir(), tag + '-log.log');

  const login = (userId, overrides) => {
    const token = 'tok-' + userId + '-' + Math.random().toString(36).slice(2);
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const all = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    all[hash] = Object.assign({
      user_id: userId, id: userId, school: 'GIRLS', role: 'TEACHER',
      first_login: false, granted: true,
      expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString()
    }, overrides);
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(all));
    return 'nibras_session=' + encodeURIComponent(token);
  };

  return new Promise((resolve, reject) => {
    const port = 8300 + Math.floor(Math.random() * 500);
    fs.writeFileSync(SESSIONS_FILE, '{}');
    fs.writeFileSync(STATE_FILE, JSON.stringify(fx.data));
    const child = spawn(process.execPath, ['--require', HARNESS, path.join(ROOT, 'server.js')], {
      cwd: ROOT,
      env: Object.assign({}, process.env, {
        PORT: String(port),
        DATABASE_URL: 'stub://unused',
        NODE_ENV: 'test',
        STARS_FIXTURE: JSON.stringify(fx),
        STARS_SESSIONS_FILE: SESSIONS_FILE,
        STARS_STATE_FILE: STATE_FILE,
        STARS_LOG_FILE: LOG_FILE
      }),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let buf = '';
    let done = false;
    const stop = () => { try { child.kill(); } catch (_) {} };
    const timer = setTimeout(() => { if (done) return; done = true; stop(); reject(new Error('boot timeout: ' + buf.slice(0, 500))); }, 25000);
    const poll = async () => {
      if (done) return;
      try {
        const r = await fetch('http://127.0.0.1:' + port + '/api/health');
        if (r.ok) {
          done = true; clearTimeout(timer);
          resolve({
            port, stop, login,
            log: () => buf,
            db: () => JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')),
            sessions: () => JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'))
          });
          return;
        }
      } catch (_) { /* لم يجهز بعد */ }
      setTimeout(poll, 120);
    };
    child.stdout.on('data', (d) => { buf += d.toString(); });
    child.stderr.on('data', (d) => { buf += d.toString(); });
    child.on('exit', (code) => { if (!done) { done = true; clearTimeout(timer); reject(new Error('exited ' + code + ': ' + buf.slice(0, 700))); } });
    setTimeout(poll, 150);
  });
}

function req(port, method, p, { cookie, body } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch('http://127.0.0.1:' + port + p, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body)
  });
}

module.exports = { boot, req, ttCell, ROOT };
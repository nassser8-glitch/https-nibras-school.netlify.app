'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const HARNESS = path.join(__dirname, 'helpers', 'http-db-harness.js');
const sessionsFile = path.join(os.tmpdir(), 'http-test-sessions-' + process.pid + '.json');
const stateFile = path.join(os.tmpdir(), 'http-test-state-' + process.pid + '.json');
const logFile = path.join(os.tmpdir(), 'http-test-log-' + process.pid + '.log');

const fixture = {
  school: 'GIRLS',
  data: {
    users: [{ id: 'A1', name: 'المديرة', role: 'ADMIN', active: true }],
    students: [], classes: [], attendance: [],
    stars: [{ id: '2026-09-28', weekKey: '2026-09-28', studentId: 'S1', studentName: 'سارة' }]
  }
};

function startServer() {
  return new Promise((resolve, reject) => {
    const port = 8800 + Math.floor(Math.random() * 500);
    fs.writeFileSync(sessionsFile, '{}');
    fs.writeFileSync(stateFile, JSON.stringify(fixture.data));
    const child = spawn(process.execPath, ['--require', HARNESS, path.join(ROOT, 'server.js')], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(port),
        DATABASE_URL: 'stub://unused',
        NODE_ENV: 'test',
        HTTP_TEST_FIXTURE: JSON.stringify(fixture),
        HTTP_TEST_SESSIONS_FILE: sessionsFile,
        HTTP_TEST_STATE_FILE: stateFile,
        HTTP_TEST_LOG_FILE: logFile
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    let done = false;
    const timeout = setTimeout(() => {
      if (done) return;
      done = true;
      child.kill();
      reject(new Error('server did not start: ' + output.slice(0, 1000)));
    }, 25000);
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('exit', code => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      reject(new Error('server exited ' + code + ': ' + output.slice(0, 1000)));
    });
    const poll = async () => {
      if (done) return;
      try {
        const response = await fetch('http://127.0.0.1:' + port + '/api/health');
        if (response.ok) {
          done = true;
          clearTimeout(timeout);
          resolve({ port, child });
          return;
        }
      } catch (_) {}
      setTimeout(poll, 100);
    };
    setTimeout(poll, 120);
  });
}

let server;
test.before(async () => { server = await startServer(); });
test.after(() => {
  if (server) server.child.kill();
  for (const file of [sessionsFile, stateFile, logFile]) {
    try { fs.unlinkSync(file); } catch (_) {}
  }
});

test('Star of the Week API and client asset are absent over real HTTP', async () => {
  const base = 'http://127.0.0.1:' + server.port;
  const index = await fetch(base + '/');
  assert.equal(index.status, 200);
  assert.doesNotMatch(await index.text(), /data-stw-mount|star-week\.js|رائدة الفصل/);

  for (const [method, url] of [
    ['GET', '/api/stars'],
    ['POST', '/api/stars/award'],
    ['PUT', '/api/stars/award'],
    ['PATCH', '/api/stars/award'],
    ['DELETE', '/api/stars/award']
  ]) {
    const response = await fetch(base + url, { method });
    assert.equal(response.status, 404, method + ' ' + url);
  }
  assert.equal((await fetch(base + '/star-week.js')).status, 404);

  const persisted = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.equal(persisted.stars[0].studentId, 'S1', 'legacy saved records are left untouched');
});

test('app source and Docker image no longer contain the feature implementation', () => {
  const serverSource = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const indexSource = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const workerSource = fs.readFileSync(path.join(ROOT, 'public', 'sw.js'), 'utf8');
  const dockerSource = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
  assert.doesNotMatch(serverSource, /require\(['"]\.\/star-week|\/api\/stars/);
  assert.doesNotMatch(indexSource, /data-stw-mount|star-week\.js|\.stw-/);
  assert.doesNotMatch(workerSource, /star-week\.js/);
  assert.doesNotMatch(dockerSource, /star-week\.js/);
  assert.equal(fs.existsSync(path.join(ROOT, 'star-week.js')), false);
  assert.equal(fs.existsSync(path.join(ROOT, 'public', 'star-week.js')), false);
  assert.match(serverSource, /const serverStars = \(prev\.data \|\| \{\}\)\.stars;/,
    'legacy data remains protected from stale clients');
});

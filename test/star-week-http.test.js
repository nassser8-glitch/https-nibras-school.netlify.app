'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const vm = require('vm');
const { spawn } = require('child_process');
const starWeek = require('../star-week.js');

const ROOT = path.join(__dirname, '..');
const HARNESS = path.join(__dirname, 'helpers', 'stars-http-harness.js');
const FILES = ['stars-http-sessions-' + process.pid + '.json', 'stars-http-state-' + process.pid + '.json'];
const SESSIONS_FILE = path.join(os.tmpdir(), FILES[0]);
const STATE_FILE = path.join(os.tmpdir(), FILES[1]);
const LOG_FILE = path.join(os.tmpdir(), 'stars-http-log-' + process.pid + '.log');
const ROLES = ['ADMIN', 'AGENT', 'COUNSELOR', 'TEACHER', 'ADMINISTRATIVE', 'SCHOOL_AGENT', 'STUDENT'];
const CURRENT_WEEK = starWeek.currentWeek(Date.now(), starWeek.SCHOOL_TZ_OFFSET_MIN).key;
const PAST_WEEK = starWeek.currentWeek(Date.parse(CURRENT_WEEK + 'T12:00:00Z') - 7 * 24 * 60 * 60 * 1000,
  starWeek.SCHOOL_TZ_OFFSET_MIN).key;

function fixture() {
  return {
    school: 'GIRLS',
    data: {
      grades: [{ id: 'G1', name: 'الصف الأول' }],
      users: [
        { id: 'A1', name: 'المديرة', role: 'ADMIN', active: true },
        { id: 'T1', name: 'المعلمة', role: 'TEACHER', active: true },
        { id: 'S1', name: 'نورة', role: 'STUDENT', active: true },
        { id: 'M1', name: 'إدارية', role: 'ADMINISTRATIVE', active: true }
      ],
      classes: [
        { id: 'C1', name: 'أ', gradeId: 'G1', teacherIds: ['T1'] },
        { id: 'C2', name: 'ب', gradeId: 'G1', teacherIds: ['T1'] }
      ],
      students: [
        { id: 'S1', fullName: 'نورة', classId: 'C1' },
        { id: 'S2', fullName: 'سارة', classId: 'C1' },
        { id: 'S3', fullName: 'ريم', classId: 'C2' }
      ],
      attendance: [{ id: 'ATT1', studentId: 'S1', date: '2026-09-30', status: 'present' }],
      notes: [{ id: 'NOTE1', studentId: 'S1', points: 4 }],
      pointsLedger: [{ id: 'POINT1', studentId: 'S1', points: 4 }],
      timetable: {},
      stars: [{
        id: PAST_WEEK, weekKey: PAST_WEEK, classId: 'C1', studentId: 'S2',
        studentName: 'سارة', traits: ['mjthda'], message: 'الأسبوع السابق',
        createdAt: '2026-09-21T08:00:00.000Z', updatedAt: '2026-09-21T08:00:00.000Z'
      }]
    }
  };
}

function boot(initial) {
  return new Promise((resolve, reject) => {
    const port = 8800 + Math.floor(Math.random() * 500);
    fs.writeFileSync(SESSIONS_FILE, '{}');
    fs.writeFileSync(STATE_FILE, JSON.stringify(initial.data));
    const child = spawn(process.execPath, ['--require', HARNESS, path.join(ROOT, 'server.js')], {
      cwd: ROOT,
      env: Object.assign({}, process.env, {
        PORT: String(port), DATABASE_URL: 'stub://unused', NODE_ENV: 'test',
        STARS_FIXTURE: JSON.stringify(initial), STARS_SESSIONS_FILE: SESSIONS_FILE,
        STARS_STATE_FILE: STATE_FILE, STARS_LOG_FILE: LOG_FILE
      }),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    let settled = false;
    const stop = () => { try { child.kill(); } catch (_) {} };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      stop();
      reject(new Error('server did not start: ' + output.slice(0, 1000)));
    }, 25000);
    child.stdout.on('data', d => { output += d.toString(); });
    child.stderr.on('data', d => { output += d.toString(); });
    child.on('exit', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error('server exited ' + code + ': ' + output.slice(0, 1000)));
    });
    const poll = async () => {
      if (settled) return;
      try {
        const response = await fetch('http://127.0.0.1:' + port + '/api/health');
        if (response.ok) {
          settled = true;
          clearTimeout(timer);
          resolve({ port, stop, data: () => JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) });
          return;
        }
      } catch (_) {}
      setTimeout(poll, 100);
    };
    setTimeout(poll, 120);
  });
}

let server;
let original;
test.before(async () => {
  original = fixture();
  server = await boot(original);
});
test.after(() => {
  if (server) server.stop();
  for (const file of [SESSIONS_FILE, STATE_FILE, LOG_FILE]) {
    try { fs.unlinkSync(file); } catch (_) {}
  }
});

async function login(userId, role) {
  const token = 'stars-' + userId + '-' + crypto.randomBytes(8).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const sessions = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
  sessions[tokenHash] = {
    user_id: userId, school: 'GIRLS', role, first_login: false, granted: true,
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  };
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions));
  return 'nibras_session=' + encodeURIComponent(token);
}

function request(method, endpoint, { cookie, body } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch('http://127.0.0.1:' + server.port + endpoint, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body)
  });
}

test('server no longer integrates Star of the Week into account dashboards', async () => {
  const index = await request('GET', '/');
  assert.equal(index.status, 200);
  assert.doesNotMatch(await index.text(), /data-stw-mount|star-week\.js/);
});

test('HTTP acceptance: 16/16 ADMIN, authorization, persistence, integrity, and reveal checks PASS', async () => {
  let passed = 0;
  const check = async (name, assertion) => {
    await assertion();
    passed++;
  };
  const admin = await login('A1', 'ADMIN');
  const initialData = server.data();

  await check('1 ADMIN creates', async () => {
    const response = await request('POST', '/api/stars/award', {
      cookie: admin, body: { classId: 'C1', studentId: 'S1', traits: ['mjthda', 'khuluqa'], message: 'اختيار المديرة' }
    });
    assert.equal(response.status, 200, await response.text());
    assert.equal(server.data().stars.filter(s => s.weekKey !== PAST_WEEK).length, 1);
  });

  await check('2 ADMIN updates', async () => {
    const response = await request('PUT', '/api/stars/award', {
      cookie: admin, body: { classId: 'C2', studentId: 'S3', traits: ['masrwla'], message: 'تم التعديل' }
    });
    assert.equal(response.status, 200, await response.text());
    const current = server.data().stars.filter(s => s.weekKey !== PAST_WEEK);
    assert.equal(current.length, 1);
    assert.equal(current[0].studentId, 'S3');
  });

  await check('3 TEACHER cannot create', async () => {
    const response = await request('POST', '/api/stars/award', {
      cookie: await login('T1', 'TEACHER'), body: { classId: 'C1', studentId: 'S1', traits: ['mjthda'] }
    });
    assert.equal(response.status, 403);
  });

  await check('4 STUDENT cannot create', async () => {
    const response = await request('POST', '/api/stars/award', {
      cookie: await login('S1', 'STUDENT'), body: { classId: 'C1', studentId: 'S1', traits: ['mjthda'] }
    });
    assert.equal(response.status, 403);
  });

  await check('5 anonymous cannot create', async () => {
    const response = await request('POST', '/api/stars/award', {
      body: { classId: 'C1', studentId: 'S1', traits: ['mjthda'] }
    });
    assert.equal(response.status, 401);
  });

  await check('6 all school roles can read', async () => {
    for (const role of ROLES) {
      const response = await request('GET', '/api/stars', { cookie: await login('U-' + role, role) });
      assert.equal(response.status, 200, role);
      assert.equal((await response.json()).stars.length, 1, role + ' sees the school award');
    }
  });

  await check('7 server reload preserves award', async () => {
    const response = await request('GET', '/api/stars', { cookie: admin });
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.stars[0].studentId, 'S3');
    assert.equal(data.stars[0].message, 'تم التعديل');
  });

  await check('8 independent session/device sees award', async () => {
    const response = await request('GET', '/api/stars', { cookie: await login('T1', 'TEACHER') });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).stars[0].studentId, 'S3');
  });

  await check('9 student from another class is rejected', async () => {
    const response = await request('POST', '/api/stars/award', {
      cookie: admin, body: { classId: 'C1', studentId: 'S3', traits: ['mjthda'] }
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, 'student_not_in_class');
  });

  await check('10 only one award exists per school/week', async () => {
    const response = await request('PATCH', '/api/stars/award', {
      cookie: admin, body: { classId: 'C1', studentId: 'S2', traits: ['khuluqa'] }
    });
    assert.equal(response.status, 200);
    assert.equal(server.data().stars.filter(s => s.weekKey !== PAST_WEEK).length, 1);
    assert.equal(server.data().stars.find(s => s.weekKey !== PAST_WEEK).studentId, 'S2');
  });

  await check('11 previous weeks remain stored', async () => {
    const stars = server.data().stars;
    assert.ok(stars.some(s => s.weekKey === PAST_WEEK));
    const response = await request('GET', '/api/stars', { cookie: admin });
    const view = await response.json();
    assert.ok(view.history.some(s => s.weekKey === PAST_WEEK));
  });

  await check('12 students remain unchanged', async () => {
    assert.deepEqual(server.data().students, initialData.students);
  });

  await check('13 staff/user records remain unchanged', async () => {
    assert.deepEqual(server.data().users, initialData.users);
  });

  await check('14 classes remain unchanged', async () => {
    assert.deepEqual(server.data().classes, initialData.classes);
  });

  await check('15 attendance, notes, and points remain unchanged', async () => {
    for (const section of ['attendance', 'notes', 'pointsLedger'])
      assert.deepEqual(server.data()[section], initialData[section], section);
  });

  await check('16 eraser card renders the saved server award', async () => {
    const response = await request('GET', '/api/stars', { cookie: await login('S1', 'STUDENT') });
    const view = await response.json();
    const ui = {
      document: { readyState: 'complete', querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, body: {} },
      localStorage: { getItem: () => null, setItem() {} },
      matchMedia: () => ({ matches: false }), requestAnimationFrame: fn => fn(),
      getComputedStyle: () => ({ getPropertyValue: () => '#be185d' }),
      addEventListener() {}, setTimeout() {}, console, fetch() { return Promise.reject(new Error('unexpected fetch')); }
    };
    ui.window = ui;
    vm.createContext(ui);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'public', 'star-week.js'), 'utf8'), ui);
    ui.__stwState.view = view;
    const html = ui.__stwSectionHTML();
    const star = view.stars[0];
    assert.ok(html.includes(star.studentName));
    assert.ok(html.includes(star.className));
    assert.ok(html.includes(star.message));
    assert.ok(star.traitsLabels.every(label => html.includes(label)));
    assert.ok(html.includes('data-stw-eraser'));
  });

  const teacher = await login('T1', 'TEACHER');
  const student = await login('S1', 'STUDENT');
  for (const cookie of [teacher, student]) {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const response = await request(method, '/api/stars/award', {
        cookie, body: { classId: 'C1', studentId: 'S1', traits: ['mjthda'] }
      });
      assert.equal(response.status, 403, method + ' non-ADMIN');
    }
  }
  const noSessionDelete = await request('DELETE', '/api/stars/award');
  assert.equal(noSessionDelete.status, 401);
  const adminDelete = await request('DELETE', '/api/stars/award', { cookie: admin });
  assert.equal(adminDelete.status, 405);
  console.log('HTTP star-of-the-week acceptance: ' + passed + '/16 PASS');
  assert.equal(passed, 16);
});

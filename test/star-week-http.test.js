'use strict';
// اختبار تكامل HTTP حقيقي: يشغّل server.js الأصلي (Express حقيقي + توجيه حقيقي +
// ملفات ثابتة حقيقية) مع db مُستبدل، ثم يطلب المسارات عبر HTTP فعلي.
// هذا يغلق الفجوة التي لا يغطّيها فحص النص: المسار والتنسيق والجلسة والكوكي.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const HARNESS = path.join(__dirname, 'helpers', 'stars-http-harness.js');

const DAY_KEYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'];
function ttCell(classId, n) {
  const t = {};
  for (const d of DAY_KEYS) { t[d] = {}; for (let p = 1; p <= n; p++) t[d][p] = { classId, subject: 'رياضيات' }; }
  return t;
}

function fixture() {
  return {
    school: 'GIRLS',
    data: {
      grades: [{ id: 'G1', name: 'الصف الأول' }],
      stages: [{ id: 'ST1', name: 'المرحلة' }],
      sections: [{ id: 'SC1', name: 'قسم أ' }],
      stageId: 'ST1', section: 'SC1', grade: 'G1',
      users: [
        { id: 'A1', name: 'المدير', username: 'admin', role: 'ADMIN', active: true },
        { id: 'T1', name: 'أ. رائدة', username: 'raedah', role: 'TEACHER', active: true },
        { id: 'T2', name: 'أ. ثانية', username: 'thanya', role: 'TEACHER', active: true },
        { id: 'S1', name: 'نورة', username: 'noura', role: 'STUDENT', active: true },
        { id: 'S2', name: 'سارة', username: 'sara', role: 'STUDENT', active: true }
      ],
      classes: [{ id: 'C1', name: '1/أ', gradeId: 'G1', teacherIds: ['T1', 'T2'], deleted: false }],
      students: [
        { id: 'S1', fullName: 'نورة', classId: 'C1' },
        { id: 'S2', fullName: 'سارة', classId: 'C1' }
      ],
      timetable: { T1: ttCell('C1', 5), T2: ttCell('C1', 2) },
      attendance: [], notes: [], transfers: [], maintenance: [],
      adminMsgs: [], announcements: [], suggestions: [],
      stars: []
    },
    sessions: {}   // tokenHash -> session row
  };
}

// يشغّل الخادم على منفذ حقيقي وينتظر جهوزيته عبر /api/health
const SESSIONS_FILE = path.join(os.tmpdir(), 'stars-http-sessions-' + process.pid + '.json');
const STATE_FILE = path.join(os.tmpdir(), 'stars-http-state-' + process.pid + '.json');
const LOG_FILE = path.join(os.tmpdir(), 'stars-http-log-' + process.pid + '.log');

function boot(fx) {
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
    const serverLog = () => buf;
    const timer = setTimeout(() => { if (done) return; done = true; stop(); reject(new Error('boot timeout: ' + buf.slice(0, 500))); }, 25000);
    const poll = async () => {
      if (done) return;
      try {
        const r = await fetch('http://127.0.0.1:' + port + '/api/health');
        if (r.ok) {
          done = true; clearTimeout(timer);
          resolve({ port, stop, log: serverLog, db: () => JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) });
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

let srv = null;
test.before(async () => { srv = await boot(fixture()); });
test.after(() => { if (srv) srv.stop(); });

function req(port, method, p, { cookie, body } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch('http://127.0.0.1:' + port + p, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body)
  });
}

// يسجّل جلسة في الخادم (كما يفعل تسجيل الدخول) ويعيد الكوكي.
// الخادم يقرأ ملف الجلسات في كل طلب، فهذا يكافئ جدول real جلسات.
async function login(port, userId, overrides) {
  const token = 'tok-' + userId + '-' + Math.random().toString(36).slice(2);
  const hash = require('crypto').createHash('sha256').update(token).digest('hex');
  const all = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
  all[hash] = Object.assign({ id: userId, school: 'GIRLS', role: 'TEACHER', first_login: false, granted: true }, overrides);
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(all));
  return 'nibras_session=' + encodeURIComponent(token);
}

test('الحزمة تُقدَّم من الخادم (200 + نوع صحيح)', async () => {
  const r = await req(srv.port, 'GET', '/star-week.js');
  assert.strictEqual(r.status, 200, 'الملف موجود ويُقدَّم');
  assert.ok(/javascript/.test(r.headers.get('content-type') || ''), 'نوع JS صحيح');
  assert.ok((await r.text()).includes('data-stw-eraser'), 'المحتوى هو ملف الميزة');
});

test('index.html يشير إلى الحزمة والوسم موجود', async () => {
  const r = await req(srv.port, 'GET', '/');
  const html = await r.text();
  assert.strictEqual(r.status, 200);
  assert.ok(html.includes('star-week.js'), 'الوسم موجود في الصفحة المُقدَّمة');
  assert.ok(html.includes('data-stw-mount'), 'نقطة التركيب موجودة');
});

test('بلا جلسة ⇒ 401 على المسارات الثلاثة', async () => {
  for (const [m, p] of [['GET', '/api/stars'], ['POST', '/api/stars/award'], ['DELETE', '/api/stars/award']]) {
    const r = await req(srv.port, m, p, m === 'POST' ? { body: {} } : {});
    assert.strictEqual(r.status, 401, m + ' ' + p + ' يجب أن يُرفض بلا جلسة');
  }
});

test('GET /api/stars: الرائدة محسوبة من الجدول وتظهر للمدير', async () => {
  const c = await login(srv.port, 'A1', { role: 'ADMIN' });
  const r = await req(srv.port, 'GET', '/api/stars', { cookie: c });
  assert.strictEqual(r.status, 200);
  const j = await r.json();
  assert.strictEqual(j.ok, true);
  assert.ok(Array.isArray(j.traits) && j.traits.length >= 10, 'الصفات مُرسلة من الخادم');
  assert.ok(j.week && j.week.key && j.week.label, 'معلومات الأسبوع');
  assert.deepStrictEqual(j.stars, [], 'لا نجوم بعد');
  assert.deepStrictEqual(j.owners.map(o => o.ownerId), ['T1'], 'الرائدة T1 (25 حصة مقابل 10)');
  // ttCell(5) = 5 أيام × 5 حصص = 25 خانة أسبوعية، وT2 = 5 × 2 = 10
  assert.strictEqual(j.owners[0].periods, 25, 'عدد الحصص الأسبوعية صحيح');
  assert.strictEqual(j.owners[0].tie, false, 'لا تعادل');
});

test('POST /api/stars/award: المعلمة الرائدة فقط تستطيع الاختيار', async () => {
  const owner = await login(srv.port, 'T1', { role: 'TEACHER' });
  const r = await req(srv.port, 'POST', '/api/stars/award', {
    cookie: owner,
    body: { school: 'GIRLS', classId: 'C1', studentId: 'S1', traits: ['khuluqa', 'jazda'], message: 'ممتازة' }
  });
  assert.strictEqual(r.status, 200, 'الرائدة تُقبل');
  const j = await r.json();
  assert.strictEqual(j.ok, true);
  assert.strictEqual(j.stars.length, 1);
  assert.strictEqual(j.stars[0].studentId, 'S1');
  assert.strictEqual(j.stars[0].teacherId, 'T1', 'teacherId من الجلسة');
  // تغيّر قاعدة البيانات فعليًا (وليس مجرد رد)
  assert.strictEqual(srv.db().stars.length, 1, 'الكُتب في القاعدة');
  assert.strictEqual(srv.db().stars[0].classId, 'C1');
});

test('معلمة غير رائدة تُرفض (403) ولا يُكتب شيء', async () => {
  const before = srv.db().stars.length;
  const c = await login(srv.port, 'T2', { role: 'TEACHER' });
  const r = await req(srv.port, 'POST', '/api/stars/award', {
    cookie: c, body: { school: 'GIRLS', classId: 'C1', studentId: 'S2', traits: ['khuluqa'] }
  });
  assert.strictEqual(r.status, 403, 'غير الرائدة تُرفض');
  assert.strictEqual(srv.db().stars.length, before, 'لا تغيير في القاعدة');
});

test('الطالبة ترفض محاولات التزوير', async () => {
  const before = JSON.stringify(srv.db().stars);
  const c = await login(srv.port, 'S1', { role: 'STUDENT' });
  const r = await req(srv.port, 'POST', '/api/stars/award', {
    cookie: c,
    body: { school: 'GIRLS', classId: 'C1', studentId: 'S2', traits: ['khuluqa'],
      teacherId: 'T1', stars: [{ id: 'forged', studentId: 'HACK' }] }
  });
  assert.ok(r.status === 403 || r.status === 400, 'الطالبة تُرفض: ' + r.status);
  assert.strictEqual(JSON.stringify(srv.db().stars), before, 'لا تزوير');
});

test('الطالبة ترى نجمة فصلها بعد الحفظ', async () => {
  const c = await login(srv.port, 'S1', { role: 'STUDENT' });
  const r = await req(srv.port, 'GET', '/api/stars', { cookie: c });
  const j = await r.json();
  assert.strictEqual(j.stars.length, 1, 'الطالبة ترى نجمة فصلها');
  assert.strictEqual(j.stars[0].studentId, 'S1');
  assert.strictEqual(j.me.role, 'STUDENT');
  assert.strictEqual(j.me.isManager, false);
});

test('GET /api/db يعيد القسم للعميل (كي لا يمحوه الحفظ)', async () => {
  const c = await login(srv.port, 'A1', { role: 'ADMIN' });
  const r = await req(srv.port, 'GET', '/api/db/GIRLS', { cookie: c });
  assert.strictEqual(r.status, 200);
  const j = await r.json();
  assert.ok(Array.isArray(j.data.stars) && j.data.stars.length === 1, 'القسم موجود في حمولة العميل');
});

test('PUT /api/db: حمولة بلا stars لا تمحو النجوم', async () => {
  const c = await login(srv.port, 'A1', { role: 'ADMIN' });
  const cur = srv.db();
  const payload = JSON.parse(JSON.stringify(cur));
  delete payload.stars;                       // حمولة ناقصة
  payload.grades[0].name = 'الصف الأول المعدّل';
  const r = await req(srv.port, 'PUT', '/api/db/GIRLS', { cookie: c, body: { ts: Date.now(), data: payload } });
  assert.strictEqual(r.status, 200, 'الحفظ نجح: ' + await r.text() + '\n--- log ---\n' + srv.log().slice(-1200));
  assert.ok(Array.isArray(srv.db().stars), 'النجوم ما زالت موجودة');
  assert.strictEqual(srv.db().stars.length, 1, 'لم تُمحَ');
  assert.strictEqual(srv.db().grades[0].name, 'الصف الأول المعدّل', 'والتعديل الآخر نُفِّذ');
});

test('PUT /api/db: محاولة تزوير نجمة عبر المسار العام مرفوضة', async () => {
  const c = await login(srv.port, 'A1', { role: 'ADMIN' });
  const payload = JSON.parse(JSON.stringify(srv.db()));
  payload.stars = [{ id: 'w::C1', weekKey: '2099-01-01', classId: 'C1', studentId: 'HACK', teacherId: 'T1' }];
  const r = await req(srv.port, 'PUT', '/api/db/GIRLS', { cookie: c, body: { ts: Date.now(), data: payload } });
  assert.strictEqual(r.status, 200, 'الحفظ نجح: ' + await r.text() + '\n--- log ---\n' + srv.log().slice(-1200));
  assert.strictEqual(srv.db().stars.length, 1, 'لم تُضَف نجمة مزوّرة');
  assert.notStrictEqual(srv.db().stars[0].studentId, 'HACK');
});

test('PUT /api/db: الطالبة تحاول المسح — فلاتر الأدوار تمنع الأثر الفعلي', async () => {
  const c = await login(srv.port, 'S1', { role: 'STUDENT' });
  const payload = JSON.parse(JSON.stringify(srv.db()));
  payload.stars = [];                          // محاولة مسح كل النجوم
  payload.grades[0].name = 'اختراق';            // محاولة تعديل بنيوي
  const before = srv.db();
  const r = await req(srv.port, 'PUT', '/api/db/GIRLS', { cookie: c, body: { ts: Date.now(), data: payload } });
  // المسار العام يصله الطالبة (سلوك التطبيق القائم) لكن فلاتر الأدوار تمنع الكتابة الفعلية:
  // المهم أن النجوم لم تُمَح وأن البنية لم تتغيّر.
  assert.ok(r.status === 200 || r.status === 403 || r.status === 400, 'رد متوقع: ' + r.status);
  const after = srv.db();
  assert.strictEqual(after.stars.length, before.stars.length, 'النجوم لم تُمَح');
  assert.strictEqual(after.grades[0].name, before.grades[0].name, 'البنى لم تتغيّر');
});

test('GET /api/stars لمدرسة أخرى ⇒ 400، وصلاحية عبر المدارس ⇒ 403', async () => {
  const c = await login(srv.port, 'A1', { role: 'ADMIN' });
  const bad = await req(srv.port, 'GET', '/api/stars?school=NOPE', { cookie: c });
  assert.strictEqual(bad.status, 400, 'مدرسة غير معروفة');
  // معلّمة من مدرسة أخرى. (مدير النظام ADMIN يُسمح له بالمديرين حسب تصميم
  // التطبيق القائم schoolAccess، فالفحص الصحيح هنا على غير المدير.)
  const token = 'tok-X1';
  const hash = require('crypto').createHash('sha256').update(token).digest('hex');
  const all = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
  all[hash] = { id: 'X1', school: 'BOYS', role: 'TEACHER', first_login: false, granted: true };
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(all));
  const c2 = 'nibras_session=' + encodeURIComponent(token);
  const forbidden = await req(srv.port, 'GET', '/api/stars?school=GIRLS', { cookie: c2 });
  assert.strictEqual(forbidden.status, 403, 'لا صلاحية عبر المدارس');
  // ولا تستطيع الكتابة في مدرسة أخرى
  const w = await req(srv.port, 'POST', '/api/stars/award', {
    cookie: c2, body: { school: 'GIRLS', classId: 'C1', studentId: 'S2', traits: ['khuluqa'] }
  });
  assert.strictEqual(w.status, 403, 'الكتابة عبر المدارس مرفوضة');
});

test('DELETE محظور (السجل دائم) عبر HTTP الحقيقي', async () => {
  const c = await login(srv.port, 'A1', { role: 'ADMIN' });
  const r = await req(srv.port, 'DELETE', '/api/stars/award', { cookie: c });
  assert.strictEqual(r.status, 405, 'الحذف غير مسموح');
});

test('صفحات أخرى لا تُسرّب: المسار بلا استعلام يعيد بيانات المدرسة من الجلسة', async () => {
  const c = await login(srv.port, 'T1', { role: 'TEACHER' });
  const r = await req(srv.port, 'GET', '/api/stars', { cookie: c });
  const j = await r.json();
  assert.strictEqual(j.school, 'GIRLS', 'أُخذت من الجلسة');
  assert.strictEqual(j.stars.length, 1, 'الرائية ترى نجمة فصلها');
  assert.ok((j.me.ownedClassIds || []).includes('C1'),
    'فصولها الملكية: ' + JSON.stringify(j.me) + ' | classes=' + JSON.stringify(srv.db().classes) +
    ' | users=' + JSON.stringify((srv.db().users || []).map(u => [u.id, u.role, u.active])));
});

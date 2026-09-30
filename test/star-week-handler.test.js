'use strict';
// اختبار على مستوى المعالج: نستخرج كود المسارات الفعلي من server.js وننفّذه
// بـ req/res وهميين وdb مُموَّه. هذا يختبر الشيفرة المشحونة فعلًا (لا نسخة منها)
// دون تشغيل Express أو PostgreSQL أو أي شبكة.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SERVER = path.join(ROOT, 'server.js');
const SRC = fs.readFileSync(SERVER, 'utf8');
const starWeek = require(path.join(ROOT, 'star-week.js'));

const DAY_KEYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'];
function ttCell(classId, perDay){
  const t = {};
  for (const day of DAY_KEYS){
    t[day] = {};
    for (let p = 1; p <= perDay; p++) t[day][p] = { classId, subject: 'رياضيات' };
  }
  return t;
}
function baseData(){
  return {
    grades: [{ id: 'G1', name: 'الصف السادس' }],
    classes: [
      { id: 'C1', name: 'أ', gradeId: 'G1', teacherIds: ['T1', 'T2'] },
      { id: 'C2', name: 'ب', gradeId: 'G1', teacherIds: ['T3'] }
    ],
    students: [
      { id: 'S1', fullName: 'نورة الحربي', classId: 'C1' },
      { id: 'S2', fullName: 'سارة محمد', classId: 'C1' },
      { id: 'S3', fullName: 'ريم خالد', classId: 'C2' }
    ],
    users: [
      { id: 'T1', name: 'أ. رائدة', role: 'TEACHER', active: true },
      { id: 'T2', name: 'أ. ثانية', role: 'TEACHER', active: true },
      { id: 'T3', name: 'أ. ثالثة', role: 'TEACHER', active: true }
    ],
    timetable: { T1: ttCell('C1', 5), T2: ttCell('C1', 1), T3: ttCell('C2', 4) },
    stars: [],
    attendance: [{ id: 'A1', studentId: 'S1', date: '2026-09-28', status: 'present' }],
    pointsLedger: [{ id: 'P1', studentId: 'S1', delta: 7 }]
  };
}

// يستخرج جسم المعالج من مصدر server.js: نأخذ الدالة Anonymous التي تلي app.post/get
function extractHandler(routeLiteral){
  const at = SRC.indexOf(routeLiteral);
  if (at === -1) throw new Error('route not found: ' + routeLiteral);
  const open = SRC.indexOf('(', at);
  // نبدأ من جسم الدالة: أول '=>' بعد الفاصلة الأولى
  const arrow = SRC.indexOf('=>', open);
  const bodyStart = SRC.indexOf('{', arrow);
  let depth = 0, i = bodyStart;
  for (; i < SRC.length; i++){
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}'){ depth--; if (depth === 0) break; }
  }
  return SRC.slice(bodyStart, i + 1);
}

// يبني بيئة تنفيذ المعالج مع بدائل
function makeEnv(store){
  const env = {
    starWeek,
    requireAuth: (req, res, next) => next(),
    db: {
      SCHOOLS: ['GIRLS'],
      getSchoolData: async () => ({ data: store.data, ts: store.ts || 1 }),
      getSchoolSettings: async () => ({ academicStart: '2026-09-07' }),
      // نسخ عميق: يمنع تسريب مراجع النسخة السابقة
      mutateSchoolData: async (school, mutator) => {
        const data = JSON.parse(JSON.stringify(store.data));
        const out = await mutator(data);
        if (!out || out.changed !== true) return { written: false, reason: 'no_change' };
        store.data = data;
        store.ts = (store.ts || 1) + 1;
        return { written: true, value: out.value, ts: store.ts };
      },
      setSchoolData: async () => { throw new Error('setSchoolData must not be used here'); }
    },
    schoolAccess: (s, school) => !!s && (s.role === 'ADMIN' || s.school === school),
    rateLimit: () => false,
    fail: (res) => (e) => { if (process.env.STW_DEBUG) console.error('SERVER ERR:', e && e.stack); res.status(500).json({ error: 'server' }); },
    console
  };
  // الدالة المساعدة المشتركة تُستخرج من server.js كما هي (نفس الكود المشحون)
  vm.runInContext(extractFn('starWeekContext') + extractFn('starWeekNow'), vm.createContext(env));
  return env;
}

// يستخرج دالة مسنودة بالاسم من مصدر server.js (بما فيها arrow functions)
function extractFn(name){
  const re = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{');
  const m = re.exec(SRC);
  if (!m) throw new Error('function not found: ' + name);
  const bodyStart = m.index + m[0].lastIndexOf('{');
  let depth = 0;
  for (let i = bodyStart; i < SRC.length; i++){
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}'){ depth--; if (depth === 0) return SRC.slice(m.index, i + 1); }
  }
  throw new Error('unbalanced: ' + name);
}

function runHandler(routeLiteral, { session, body, query }){
  const code = extractHandler(routeLiteral);
  const store = { data: baseData(), ts: 1 };
  const env = makeEnv(store);
  const ctx = vm.createContext(env);
  // المعالج هو دالة IIFE غير متزامنة: نغلّفها كـ express handler
  vm.runInContext('globalThis.__h = function(req,res,next){ ' + code + ' };', ctx);
  const req = { session, body: body || {}, query: query || {}, params: {} };
  return new Promise(resolve => {
    const res = {
      _status: 200, _json: null, _done: false,
      status(c){ this._status = c; return this; },
      json(j){ this._json = j; this._done = true; resolve({ status: this._status, body: j, store }); },
      send(){ this._done = true; resolve({ status: this._status, body: null, store }); }
    };
    env.__h(req, res, () => {});
    setTimeout(() => { if (!res._done) resolve({ status: res._status, body: null, store, timedOut: true }); }, 1500);
  });
}

const SESS = {
  T1: { id: 'T1', role: 'TEACHER', school: 'GIRLS', first_login: false },
  T2: { id: 'T2', role: 'TEACHER', school: 'GIRLS', first_login: false },
  T3: { id: 'T3', role: 'TEACHER', school: 'GIRLS', first_login: false },
  S1: { id: 'S1', role: 'STUDENT', school: 'GIRLS', first_login: false },
  A1: { id: 'A1', role: 'ADMIN', school: 'GIRLS', first_login: false }
};
const GET = "app.get('/api/stars'";
const AWARD = "app.post('/api/stars/award'";

// ══════ 3) الرائدة تستطيع الإنشاء ══════
test('المعلمة الرائدة تنشئ نجمة عبر المسار الفعلي (200)', async () => {
  const r = await runHandler(AWARD, {
    session: SESS.T1,
    body: { classId: 'C1', studentId: 'S1', traits: ['khuluqa', 'mjthda'], message: 'أداء ممتاز' }
  });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.ok, true);
  const star = r.body.stars.find(s => s.classId === 'C1');
  assert.ok(star, 'النجمة في الاستجابة');
  assert.strictEqual(star.studentName, 'نورة الحربي');
  assert.strictEqual(star.teacherId, 'T1');
  assert.ok(star.traitsLabels.includes('🌷 خلوقة'));
  assert.strictEqual(r.store.data.stars.length, 1, 'كُتبت في الخادم');
});

// ══════ 4) غير المخولة ممنوعة ══════
test('معلمة غير مخولة تُرفض بـ 403 (ليست رائدة الفصل)', async () => {
  const r = await runHandler(AWARD, {
    session: SESS.T2,
    body: { classId: 'C1', studentId: 'S1', traits: ['khuluqa'] }
  });
  assert.strictEqual(r.status, 403);
  assert.strictEqual(r.body.error, 'not_owner');
  assert.strictEqual(r.store.data.stars.length, 0, 'لا كتابة');
});

// ══════ الطالبة ممنوعة ══════
test('الطالبة تُرفض بـ 403 عند محاولة الإنشاء', async () => {
  const r = await runHandler(AWARD, {
    session: SESS.S1,
    body: { classId: 'C1', studentId: 'S1', traits: ['khuluqa'] }
  });
  assert.strictEqual(r.status, 403);
  assert.strictEqual(r.body.error, 'forbidden');
  assert.strictEqual(r.store.data.stars.length, 0);
});

// ══════ 5) نجمتان لنفس الفصل/الأسبوع ممنوعة ══════
test('نجمة ثانية لنفس الفصل في نفس الأسبوع تُحدّث ولا تُكرّر', async () => {
  const store = { data: baseData(), ts: 1 };
  const first = await awardOn(store, SESS.T1, { classId: 'C1', studentId: 'S1', traits: ['khuluqa'] });
  assert.strictEqual(first.status, 200);
  const second = await awardOn(store, SESS.T1, { classId: 'C1', studentId: 'S2', traits: ['masrwla'] });
  assert.strictEqual(second.status, 200);
  assert.strictEqual(store.data.stars.length, 1, 'قسم النجوم فيه سجل واحد فقط');
  assert.strictEqual(store.data.stars[0].studentId, 'S2', 'اخر اختيار حُفظ');
  // فصلان مختلفان ⇒ نجمتان
  const other = await awardOn(store, SESS.T3, { classId: 'C2', studentId: 'S3', traits: ['nadhafa'] });
  assert.strictEqual(other.status, 200);
  assert.strictEqual(store.data.stars.length, 2, 'كل فصل نجمته');
});
async function awardOn(store, session, body){
  const code = extractHandler(AWARD);
  const env = makeEnv(store);
  const ctx = vm.createContext(env);
  vm.runInContext('globalThis.__h = function(req,res,next){ ' + code + ' };', ctx);
  return new Promise(resolve => {
    const res = {
      _status: 200,
      status(c){ this._status = c; return this; },
      json(j){ resolve({ status: this._status, body: j }); },
      send(){ resolve({ status: this._status, body: null }); }
    };
    env.__h({ session, body, query: {}, params: {} }, res, () => {});
    setTimeout(() => resolve({ status: res._status, body: null, timedOut: true }), 1500);
  });
}

// ══════ 7) الطالبة من فصل آخر مرفوضة ══════
test('اختيار طالبة من فصل آخر يُرفض بـ 400', async () => {
  const r = await runHandler(AWARD, {
    session: SESS.T1,
    body: { classId: 'C1', studentId: 'S3', traits: ['khuluqa'] }
  });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.body.error, 'student_not_in_class');
});

// ══════ 8) الصفات غير الصالحة ترفض whole award ══════
test('سمات غير صالحة فقط ⇒ 400 (لا حفظ نجمة بلا صفات)', async () => {
  const r = await runHandler(AWARD, {
    session: SESS.T1,
    body: { classId: 'C1', studentId: 'S1', traits: ['hack', '<script>'] }
  });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.body.error, 'bad_traits');
  assert.strictEqual(r.store.data.stars.length, 0);
});

// ══════ تحوير teacherId في الطلب لا ينجح ══════
test('teacherId في الطلب يُتجاهل (يُخزَّن من الجلسة)', async () => {
  const r = await runHandler(AWARD, {
    session: SESS.T1,
    body: { classId: 'C1', studentId: 'S1', traits: ['khuluqa'], teacherId: 'T2' }
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.store.data.stars[0].teacherId, 'T1', 'من الجلسة لا من الطلب');
});

// ══════ 12/13) الحضور والنقاط لا يُمسّان ══════
test('المسار لا يمسّ الحضور ولا النقاط', async () => {
  const r = await runHandler(AWARD, {
    session: SESS.T1,
    body: { classId: 'C1', studentId: 'S1', traits: ['khuluqa'] }
  });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.store.data.attendance, baseData().attendance, 'الحضور كما هو');
  assert.deepStrictEqual(r.store.data.pointsLedger, baseData().pointsLedger, 'النقاط كما هي');
});

// ══════ GET: رؤية كل دور ══════
test('GET /api/stars: الطالبة ترى نجمتها فقط، والإدارة ترى الكل+RXT+سجل', async () => {
  const store = { data: baseData(), ts: 1 };
  await awardOn(store, SESS.T1, { classId: 'C1', studentId: 'S1', traits: ['khuluqa'], message: 'ممتازة' });
  await awardOn(store, SESS.T3, { classId: 'C2', studentId: 'S3', traits: ['nadhafa'] });

  const stu = await getOn(store, SESS.S1);
  assert.strictEqual(stu.status, 200);
  assert.strictEqual(stu.body.stars.length, 1, 'الطالبة ترى نجمة فصلها فقط');
  assert.strictEqual(stu.body.stars[0].studentName, 'نورة الحربي');
  assert.deepStrictEqual(stu.body.me.ownedClassIds, [], 'لا تملك فصولًا');
  assert.ok(stu.body.traits.length === 12, 'قائمة الصفات من الخادم');

  const adm = await getOn(store, SESS.A1);
  assert.strictEqual(adm.body.stars.length, 2, 'الإداري يرى الكل');
  assert.strictEqual(adm.body.owners.length, 2, 'رائدة كل فصل');
  const c1 = adm.body.owners.find(o => o.classId === 'C1');
  assert.strictEqual(c1.ownerId, 'T1', 'صاحبة أكبر عدد حصص');
  assert.strictEqual(c1.periods, 25, '5 أيام × 5 حصص');
  assert.strictEqual(adm.body.history.length, 2, 'السجل كامل');
  assert.ok(adm.body.week.label.startsWith('الأسبوع'), 'تسمية الأسبوع');
  // لا حقول حساسة في الرد
  const txt = JSON.stringify(adm.body);
  assert.ok(!/username|password|studentNo|phone/i.test(txt), 'لا أسرار في الرد');
});
async function getOn(store, session){
  const code = extractHandler(GET);
  const env = makeEnv(store);
  const ctx = vm.createContext(env);
  vm.runInContext('globalThis.__h = function(req,res,next){ ' + code + ' };', ctx);
  return new Promise(resolve => {
    const res = {
      _status: 200,
      status(c){ this._status = c; return this; },
      json(j){ resolve({ status: this._status, body: j }); },
      send(){ resolve({ status: this._status, body: null }); }
    };
    env.__h({ session, body: {}, query: {}, params: {} }, res, () => {});
    setTimeout(() => resolve({ status: res._status, body: null, timedOut: true }), 1500);
  });
}

// ══════ 10) التحميل لا يفقد النجمة (الرد بعد الحفظ يحويها) ══════
test('النجمة تبقى محفوظة بعد إعادة القراءة (GET بعد POST)', async () => {
  const store = { data: baseData(), ts: 1 };
  await awardOn(store, SESS.T1, { classId: 'C1', studentId: 'S1', traits: ['khuluqa', 'masrwla'], message: 'جدّدة' });
  const g = await getOn(store, SESS.T1);
  const s = g.body.stars.find(x => x.classId === 'C1');
  assert.ok(s, 'ما زالت موجودة بعد القراءة');
  assert.strictEqual(s.message, 'جدّدة');
  assert.deepStrictEqual(s.traits, ['khuluqa', 'masrwla']);
});

// ══════ 14) تغيير classId في الطلب لا ي.par绕 ══════
test('محاولة التملّص بتغيير classId تفشل (الملكية تُشتق من الخادم)', async () => {
  // T2 تحاول اختيار نجمة لفصلها هي (C2 هي فصلها) لكنOwnership T3
  const r = await runHandler(AWARD, {
    session: SESS.T2,
    body: { classId: 'C2', studentId: 'S3', traits: ['khuluqa'] }
  });
  assert.strictEqual(r.status, 403, 'T2 ليست رائدة C2');
  assert.strictEqual(r.body.error, 'not_owner');
});

// ══════ التحقق من first_login ══════
test('المعلمة قبل تغيير كلمة المرور الأولى تُرفض', async () => {
  const r = await runHandler(AWARD, {
    session: Object.assign({}, SESS.T1, { first_login: true }),
    body: { classId: 'C1', studentId: 'S1', traits: ['khuluqa'] }
  });
  assert.strictEqual(r.status, 403);
  assert.strictEqual(r.body.error, 'change_password_first');
});

// ══════ مدرسة أخرى ممنوعة ══════
test('معلمة من مدرسة أخرى تُرفض', async () => {
  const r = await runHandler(AWARD, {
    session: { id: 'TX', role: 'TEACHER', school: 'BOYS', first_login: false },
    body: { classId: 'C1', studentId: 'S1', traits: ['khuluqa'] }
  });
  assert.ok(r.status === 400 || r.status === 403, 'مرفوضة: ' + r.status);
});

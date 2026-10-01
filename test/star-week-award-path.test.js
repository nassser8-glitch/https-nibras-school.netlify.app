'use strict';
// ===== مسار ADD/CREATE لنجمة الأسبوع — اختبار انحدار عبر HTTP الحقيقي =====
// يعالج الشكوى: «مستخدم مسجّل الدخول، مخوّل، يختار طالبة صحيحة، يضغط حفظ،
// فتظهر رسالة انتهاء الجلسة ولا تُحفظ النجمة».
// كل اختبار هنا يشغّل server.js الأصلي على منفذ حقيقي (test/helpers/http-boot.js)
// بلا أي stub بديل: Express حقيقي، requireAuth حقيقي، starWeekContext حقيقي،
// upsertAward حقيقي، وmutateSchoolData الحقيقي عبر الصف المقفل (stub ملفات).
const test = require('node:test');
const assert = require('node:assert');
const { boot, req, ttCell } = require('./helpers/http-boot');

// مستخدمون: Tahani بإدارة إدارية، T1 هي الأكثر تدريسًا (25 حصة)، T2 ثانوية (10 حصص)،
// S1/S2 طالبتان في C1، وS3 في C2 للتحقق من رفض studentId من فصل آخر.
const OWNER = 'T1';
const TAHANI = 'T9';
const C1 = 'C1';
const C2 = 'C2';
const S1 = 'S1';
const S2 = 'S2';

function fixture() {
  return {
    school: 'GIRLS',
    data: {
      grades: [{ id: 'G1', name: 'الصف الأول' }],
      stages: [{ id: 'ST1', name: 'المرحلة' }],
      sections: [{ id: 'SC1', name: 'قسم أ' }],
      stageId: 'ST1', section: 'SC1', gradeId: 'G1',
      users: [
        { id: 'A1', name: 'المدير', username: 'admin', role: 'ADMIN', active: true },
        { id: OWNER, name: 'أ. رائدة', username: 'raedah', role: 'TEACHER', active: true },
        { id: 'T2', name: 'أ. ثانية', username: 'thanya', role: 'TEACHER', active: true },
        { id: TAHANI, name: 'تهاني أحمد', username: 'tahani', role: 'ADMINISTRATIVE', active: true },
        { id: 'S1', name: 'نورة', username: 'noura', role: 'STUDENT', active: true },
        { id: 'S2', name: 'سارة', username: 'sara', role: 'STUDENT', active: true },
        { id: 'S3', name: 'هدى', username: 'huda', role: 'STUDENT', active: true }
      ],
      classes: [
        { id: C1, name: '1/أ', gradeId: 'G1', teacherIds: [OWNER, 'T2'], deleted: false },
        { id: C2, name: '1/ب', gradeId: 'G1', teacherIds: ['T2'], deleted: false }
      ],
      students: [
        { id: S1, fullName: 'نورة', classId: C1 },
        { id: S2, fullName: 'سارة', classId: C1 },
        { id: 'S3', fullName: 'هدى', classId: C2 }
      ],
      timetable: { [OWNER]: ttCell(C1, 5), T2: ttCell(C1, 2) },
      attendance: [{ id: 'att-1', classId: C1, date: '2026-10-01', status: 'PRESENT' }],
      notes: [{ id: 'n-1', classId: C1, text: 'ملاحظة' }],
      points: [{ id: 'p-1', classId: C1, studentId: S1, value: 5 }],
      stars: []
    }
  };
}

let srv = null;
test.before(async () => { srv = await boot(fixture()); });
test.after(() => { if (srv) srv.stop(); });

// الطلب الذي تفعله الواجهة تمامًا: نفس المسار ونفس الحمولة ونفس الترويسات.
// بدون credentials صريح — أيFaithFaithت سلوك fetch الافتراضي (same-origin).
function award(cookie, body) {
  return req(srv.port, 'POST', '/api/stars/award', { cookie, body });
}
function readStars(cookie) {
  return req(srv.port, 'GET', '/api/stars', { cookie });
}

// ── الاختبار الحاسم: الحالة التي بلّغ عنها المستخدم ─────────────────────────
test('انحدار: جلسة صالحة + صلاحية اختيار + طالبة صحيحة ⇒ 2xx وليس 401', async () => {
  const cookie = srv.login(TAHANI, { role: 'ADMINISTRATIVE' });
  const r = await award(cookie, {
    school: 'GIRLS', classId: C1, studentId: S1, traits: ['khuluqa'], message: 'ممتازة'
  });
  const body = await r.text();
  assert.strictEqual(r.status, 200, 'لماذا فشل الحفظ: http ' + r.status + ' — ' + body + '\n--- log ---\n' + srv.log().slice(-1500));
  assert.ok(!/unauthorized/.test(body), 'لا 401 ولا unauthorized في الرد');
  const j = JSON.parse(body);
  assert.strictEqual(j.ok, true);
  assert.strictEqual(j.stars.length, 1);
  assert.strictEqual(j.stars[0].studentId, S1, 'الطالبة المختارة هي نفسها');
  assert.strictEqual(j.stars[0].classId, C1);
  // النجمة تُنسب إلى رائدة الفصل (الأكثر تدريسًا)، لا إلى账号 الإداري الذي اختارها.
  assert.strictEqual(j.stars[0].teacherId, OWNER, 'الإسناد لرائدة الفصل');
});

test('انحدار: أي 401 في مسار الحفظ يجب أن يميّز السبب في body (لا 401 غامض)', async () => {
  // لا كوكي ⇒ 401 + سبب صريح
  const r = await award(undefined, { classId: C1, studentId: S1, traits: ['khuluqa'] });
  assert.strictEqual(r.status, 401);
  const j = await r.json();
  assert.strictEqual(j.error, 'unauthorized');
  assert.ok(j.reason, 'الـ401 يحمل سببًا: ' + JSON.stringify(j));
  assert.ok(['no_cookie', 'no_session_row'].includes(j.reason), 'سبب من مجموعة معروفة: ' + j.reason);
  // كوكي بلا صف جلسة ⇒ سبب مختلف لا نفس الشكل العام
  const r2 = await award('nibras_session=ghost', { classId: C1, studentId: S1, traits: ['khuluqa'] });
  const j2 = await r2.json();
  assert.strictEqual(j2.reason, 'no_session_row');
  // المسار داخل الرد: عميل واحد يخلط مسارات، و«غير مصرّح» بلا مسار غير قابل للتشخيص.
  assert.strictEqual(j.path, '/api/stars/award', 'الرد يسمّي المسار الذي رُفض');
  assert.deepStrictEqual(Object.keys(j).sort(), ['error', 'path', 'reason'], 'لا حقول إضافية: ' + JSON.stringify(j));
  assert.ok(!/ghost|password|token_hash/i.test(JSON.stringify(j)), 'لا تسرّب قيمة الكوكي أو الرمز');
});

// ── A: المعلمة المخولة (الأكثر تدريسًا) ─────────────────────────────────────
test('A — الرائدة تحفظ، ثم GET يعيد الطالبة نفسها', async () => {
  const cookie = srv.login(OWNER, { role: 'TEACHER' });
  const r = await award(cookie, { classId: C1, studentId: S2, traits: ['khuluqa', 'nadhafa'] });
  assert.strictEqual(r.status, 200, await r.text());
  const g = await readStars(cookie);
  const j = await g.json();
  const rec = j.stars.find(s => s.classId === C1 && s.studentId === S2);
  assert.ok(rec, 'النجمة ظاهرة بعد الحفظ');
  assert.strictEqual(rec.teacherId, OWNER);
  assert.deepStrictEqual(rec.traits, ['khuluqa', 'nadhafa']);
});

// ── B: reload / إعادة القراءة من الخادم ────────────────────────────────────
test('B — إعادة القراءة من الخادم: النجمة لا تختفي', async () => {
  const cookie = srv.login(OWNER, { role: 'TEACHER' });
  const g = await readStars(cookie);
  const j = await g.json();
  assert.ok(j.stars.some(s => s.studentId === S2), 'النجمة المحفوظة موجودة بعد القراءة');
  // نجمة واحدة لكل (فصل + أسبوع): الحفظ فوق السجل نفسه (upsert)، فلا تتراكم نسخ.
  const inC1 = srv.db().stars.filter(s => s.classId === C1);
  assert.strictEqual(inC1.length, 1, 'سجل واحد لكل فصل في الأسبوع: ' + inC1.length);
  assert.strictEqual(inC1[0].studentId, S2, 'والسجل يحمل آخر اختيار');
});

// ── C: جلسة جديدة لنفس المستخدم ────────────────────────────────────────────
test('C — جلسة جديدة لنفس المستخدم: النجمة تبقى', async () => {
  const fresh = srv.login(OWNER, { role: 'TEACHER' });
  assert.notStrictEqual(fresh, undefined);
  const g = await readStars(fresh);
  const j = await g.json();
  assert.ok(j.stars.some(s => s.studentId === S2), 'النجمة محفوظة عبر جلسة جديدة');
  const who = j.me || {};
  assert.strictEqual(who.role, 'TEACHER', 'الجلسة الجديدة فعّالة');
});

// ── D: معلمة غير مخولة ─────────────────────────────────────────────────────
test('D — معلمة ليست رائدة الفصل تُرفض (403 لا 401)', async () => {
  const cookie = srv.login('T2', { role: 'TEACHER' });
  const before = srv.db().stars.length;
  const r = await award(cookie, { classId: C1, studentId: S1, traits: ['khuluqa'] });
  assert.strictEqual(r.status, 403, 'رفض بالصلاحية: ' + r.status + ' — ' + await r.text());
  assert.strictEqual(srv.db().stars.length, before, 'لم يُكتب شيء');
});

// ── E: طالبة / مستخدم عادي ────────────────────────────────────────────────
test('E — طالبة تحاول إنشاء نجمة تُرفض (403 لا 401)', async () => {
  const cookie = srv.login(S1, { role: 'STUDENT' });
  const before = srv.db().stars.length;
  const r = await award(cookie, { classId: C1, studentId: S2, traits: ['khuluqa'], teacherId: OWNER });
  assert.strictEqual(r.status, 403, 'رفض: ' + r.status + ' — ' + await r.text());
  assert.strictEqual(srv.db().stars.length, before, 'لم يُكتب شيء');
});

// ── الصلاحية: الأكثر تدريسًا تُشتق من الجدول، لا من الاسم ولا من الاختيار ────
test('teacherId يُشتق من الأكثر تدريسًا (25 حصة مقابل 10) لا من مُدخِل الطلب', async () => {
  const cookie = srv.login(TAHANI, { role: 'ADMINISTRATIVE' });
  const r = await award(cookie, {
    classId: C1, studentId: S1, traits: ['masrwla'],
    teacherId: 'T2',                       // محاولة تزوير:人选 غير الرائدة
    studentName: 'اسم مختلف تمامًا'         // محاولة تزوير الاسم أيضًا
  });
  assert.strictEqual(r.status, 200, await r.text());
  const rec = srv.db().stars.find(s => s.classId === C1 && s.studentId === S1);
  assert.strictEqual(rec.teacherId, OWNER, 'تجاهل teacherId المزوّر واعتمد الأكثر تدريسًا');
  assert.notStrictEqual(rec.studentId, 'اسم مختلف تمامًا', 'الـstudentId هو مصدر الحقيقة');
});

// ── studentId من فصل آخر ──────────────────────────────────────────────────
test('studentId من فصل آخر يُرفض (لا يُقبل مع classId مختلف)', async () => {
  const cookie = srv.login(TAHANI, { role: 'ADMINISTRATIVE' });
  const r = await award(cookie, { classId: C1, studentId: 'S3', traits: ['khuluqa'] });
  const txt = await r.text();
  assert.strictEqual(r.status, 400, 'رفض: ' + r.status + ' — ' + txt);
  assert.strictEqual(JSON.parse(txt).error, 'student_not_in_class');
});

// ── الحمولة الناقصة تُسمّى، لا أنها 401 ───────────────────────────────────
test('حمولة ناقصة/سمات غير صالحة تُرفض بأخطاء مسمّاة (400/403) لا 401', async () => {
  const cookie = srv.login(TAHANI, { role: 'ADMINISTRATIVE' });
  const noTraits = await award(cookie, { classId: C1, studentId: S1 });
  const t1 = await noTraits.text();
  assert.strictEqual(noTraits.status, 400, t1);
  assert.strictEqual(JSON.parse(t1).error, 'bad_traits');
  const noStudent = await award(cookie, { classId: C1, traits: ['khuluqa'] });
  assert.strictEqual(noStudent.status, 400);
});

// ── بيانات المدرسة لا تُفقد بال saving نجمة ───────────────────────────────
test('الحفظ لا يمسح أي بيانات أخرى (طلاب/معلمات/فصول/حضور/نقاط/ملاحظات)', async () => {
  const before = JSON.stringify({
    students: srv.db().students, users: srv.db().users, classes: srv.db().classes,
    attendance: srv.db().attendance, points: srv.db().points, notes: srv.db().notes
  });
  const cookie = srv.login(TAHANI, { role: 'ADMINISTRATIVE' });
  const r = await award(cookie, { classId: C2, studentId: 'S3', traits: ['khuluqa', 'nadhafa'] });
  assert.strictEqual(r.status, 200, await r.text());
  const after = JSON.stringify({
    students: srv.db().students, users: srv.db().users, classes: srv.db().classes,
    attendance: srv.db().attendance, points: srv.db().points, notes: srv.db().notes
  });
  assert.strictEqual(after, before, 'بقية بيانات المدرسة كما هي');
  assert.ok(Array.isArray(srv.db().stars) && srv.db().stars.length >= 2, 'نجوم الفصلين موجودة: ' + srv.db().stars.length);
  assert.ok(srv.db().stars.some(s => s.classId === C2), 'نجمة الفصل الثاني محفوظة');
});

// ── أول_login / schoolAccess لا يعيدان 401 ────────────────────────────────
test('حساب أول_دخول لم يغيّر كلمة المرور يُرفض 403 صراحةً (ليس 401)', async () => {
  const cookie = srv.login(OWNER, { role: 'TEACHER', first_login: true });
  const r = await award(cookie, { classId: C1, studentId: S1, traits: ['khuluqa'] });
  assert.strictEqual(r.status, 403);
  assert.strictEqual((await r.json()).error, 'change_password_first');
});

test('مدرسة غير مخوّلة تُرفض 403 (لا 401) — schoolAccess سليم', async () => {
  const cookie = srv.login('T2', { role: 'TEACHER', school: 'BOYS' });
  const r = await award(cookie, { school: 'GIRLS', classId: C1, studentId: S1, traits: ['khuluqa'] });
  assert.strictEqual(r.status, 403);
});
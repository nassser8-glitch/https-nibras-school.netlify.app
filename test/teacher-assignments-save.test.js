'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const CLIENT = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

function extractFn(src, name) {
  const token = 'function ' + name + '(';
  const idx = src.indexOf(token);
  if (idx < 0) throw new Error('fn not found: ' + name);
  let i = src.indexOf('{', idx);
  let depth = 0;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return src.slice(idx, i + 1);
    }
  }
  throw new Error('unbalanced fn: ' + name);
}

test('1) الخادم: DATA_SECTION_KEYS يشمل assignments و activities ومسار /api/assignments/:school الذري موجود ويدعم TEACHER', () => {
  assert.match(
    SERVER,
    /const DATA_SECTION_KEYS = \['users','grades','classes','students','attendance','notes','transfers','maintenance','adminMsgs','announcements','suggestions','assignments','activities'\]/,
    'DATA_SECTION_KEYS يجب أن يشمل assignments و activities'
  );
  assert.ok(SERVER.includes("app.get('/api/assignments/:school'"), 'GET /api/assignments/:school موجود');
  assert.ok(SERVER.includes("app.post('/api/assignments/:school'"), 'POST /api/assignments/:school موجود');

  const postIdx = SERVER.indexOf("app.post('/api/assignments/:school'");
  const postBlock = SERVER.slice(postIdx, postIdx + 4200);
  assert.ok(postBlock.includes("'TEACHER'"), 'المعلمة مصرح لها بحفظ التكليفات');
  assert.ok(postBlock.includes('db.mutateSchoolData(school'), 'الحفظ يتم ذرياً عبر mutateSchoolData');
  assert.ok(postBlock.includes('if (forbiddenErr) return res.status(403)'), 'منع تعديل معلمة لتكليف معلمة أخرى');
});

test('2) mergeSection يحفظ التكليف الجديد ويحمي الإصدار الأعلى (_v) من الطمس بنسخة قديمة', () => {
  const code = extractFn(SERVER, 'mergeSection');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(code + '\nglobalThis.mergeSection = mergeSection;', ctx);

  const prev = [{ id: 'a1', title: 'واجب 1', teacherId: 't1', completedBy: ['s1', 's2'], _v: 3 }];
  const incoming = [
    { id: 'a1', title: 'واجب 1', teacherId: 't1', completedBy: [], _v: 1 },
    { id: 'a2', title: 'واجب سلوى الجديد', teacherId: 'id_23cfdcba56079ea5', teacherIds: ['id_23cfdcba56079ea5'], classId: 'c1', _v: 1 },
  ];
  const merged = ctx.mergeSection(prev, incoming);
  assert.equal(merged.length, 2);
  assert.deepEqual(Array.from(merged.find(x => x.id === 'a1').completedBy), ['s1', 's2']);
  assert.equal(merged.find(x => x.id === 'a2').title, 'واجب سلوى الجديد');
});

test('3) __syncPush يحافظ على obj.assignments حتى لو غاب مفتاح assignments من نسخة الخادم', () => {
  assert.ok(
    CLIENT.includes('if((mj.data && Array.isArray(mj.data.assignments)) || Array.isArray(obj.assignments)) sd.assignments = mergeByIdBetter(sd.assignments, obj.assignments);'),
    '__syncPush يجب أن يدمج obj.assignments حتى لو لم تكن mj.data.assignments مصفوفة'
  );
});

test('4) حفظ التكليف بصلاحية المعلمة (نجاح الحفظ، فشل الحفظ، والاسترجاع بعد إعادة التحميل)', async () => {
  const fnCode = [
    'let savingAssignment = false;',
    extractFn(CLIENT, 'canManageAllAssignments'),
    extractFn(CLIENT, '__resolveAssignmentInput'),
    extractFn(CLIENT, '__persistAssignmentServer'),
    extractFn(CLIENT, 'saveAssignment'),
    'globalThis.saveAssignment = saveAssignment;',
  ].join('\n');

  async function runScenario(fetchImpl) {
    let dbState = {
      users: [{ id: 'id_23cfdcba56079ea5', name: 'سلوى هدايت', role: 'TEACHER', active: true }],
      classes: [{ id: 'c1', name: 'أ', gradeId: 'g1', teacherIds: ['id_23cfdcba56079ea5'] }],
      students: [{ id: 's1', fullName: 'طالبة 1', classId: 'c1', active: true }],
      assignments: [],
    };
    const drafts = {};
    const banners = [];
    const unpushed = [];
    const locationObj = { hash: '#/assignments?step=form&cid=c1&sub=%D8%A7%D9%84%D8%B1%D9%8A%D8%A7%D8%B6%D9%8A%D8%A7%D8%AA&type=%D9%88%D8%A7%D8%AC%D8%A8' };
    const ctx = {
      URLSearchParams,
      location: locationObj,
      document: {
        getElementById: (id) => {
          if (id === 'assTitle') return { value: '  واجب الكسور  ' };
          if (id === 'assDesc') return { value: 'صفحة 12' };
          if (id === 'assDate') return { value: '2026-11-20' };
          return null;
        },
        querySelectorAll: () => [],
      },
      currentUser: () => ({ id: 'id_23cfdcba56079ea5', name: 'سلوى هدايت', role: 'TEACHER', school: 'GIRLS' }),
      getActiveSchool: () => 'GIRLS',
      loadDB: () => dbState,
      saveDB: (d) => { dbState = JSON.parse(JSON.stringify(d)); },
      uid: () => 'aid_salwa_1',
      __draftGet: (k) => drafts[k] || null,
      __draftSet: (k, v) => { drafts[k] = v; },
      __draftClear: (k) => { delete drafts[k]; },
      __markAssignUnpushed: (s, ids) => { unpushed.push(...ids); },
      __serverEnabled: () => true,
      __syncEnabled: () => true,
      __saveGuardWatch: () => {},
      __saveGuardOutcome: () => {},
      __noteSaveBanner: (msg, isErr) => { banners.push({ msg, isErr }); },
      __refreshSaveStatus: () => {},
      __syncSchedule: () => {},
      alert: (m) => { throw new Error('unexpected alert: ' + m); },
      fetch: fetchImpl,
    };
    vm.createContext(ctx);
    vm.runInContext(fnCode, ctx);
    ctx.saveAssignment();
    await new Promise(r => setTimeout(r, 20));
    return { dbState, drafts, banners, unpushed, hash: locationObj.hash };
  }

  // أ) حالة النجاح
  const okRes = await runScenario(async (url, opts) => {
    assert.equal(url, '/api/assignments/GIRLS');
    const body = JSON.parse(opts.body);
    assert.equal(body.assignment.id, 'aid_salwa_1');
    assert.equal(body.assignment.teacherId, 'id_23cfdcba56079ea5');
    assert.equal(body.assignment.title, 'واجب الكسور');
    return { ok: true, status: 200, json: async () => ({ ok: true, count: 1, assignments: [body.assignment] }) };
  });
  assert.equal(okRes.dbState.assignments.length, 1);
  assert.equal(okRes.drafts.assignment, undefined, 'المسودة تُمسح بعد تأكيد الخادم');
  assert.ok(okRes.hash.includes('step=list&cid=c1'), 'ينتقل لقائمة التكليفات بعد تأكيد الخادم');
  assert.ok(okRes.banners.some(b => !b.isErr && b.msg.includes('تم حفظ التكليف')), 'يظهر إشعار النجاح');

  // ب) حالة فشل الخادم (500): لا انتقال، وتبقى المسودة والبيانات محفوظة محلياً
  const failRes = await runScenario(async () => ({
    ok: false, status: 500, json: async () => ({ error: 'server_error' }),
  }));
  assert.equal(failRes.dbState.assignments.length, 1, 'التكليف يبقى محفوظاً محلياً عند الفشل');
  assert.ok(failRes.drafts.assignment && failRes.drafts.assignment.aid === 'aid_salwa_1', 'تبقى المسودة للمحاولة اللاحقة');
  assert.ok(failRes.hash.includes('step=form'), 'لا يغادر النموذج عند فشل الحفظ');
  assert.ok(failRes.banners.some(b => b.isErr), 'يظهر تنبيه فشل صريح');

  // ج) محاكاة إعادة التحميل (استرجاع من النسخة المحفوظة)
  const reloaded = JSON.parse(JSON.stringify(okRes.dbState));
  assert.equal(reloaded.assignments[0].id, 'aid_salwa_1');
  assert.equal(reloaded.assignments[0].teacherId, 'id_23cfdcba56079ea5');
  assert.equal(reloaded.assignments[0].classId, 'c1');
});

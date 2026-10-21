'use strict';
/* متابعة المعلمة (عين المدير/الوكيل): تحويلاتها وتكليفاتها وملاحظاتها وموعد إشرافها.
   يتحقق هذا الملف من جذر الملكية (createdBy/teacherId) في الفلاتر ومن فروع
   buildTeacherDetail الجديدة ASSIGNMENTS وSUPERVISION ومن وصل البطاقات في
   renderTeacherPage — فلا يُنسب عمل زميلة إلى المعلمة المعروضة. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

function extractFn(src, name){
  const start = src.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'دالة مفقودة: ' + name);
  const open = src.indexOf('{', start);
  let depth = 0;
  for(let i = open; i < src.length; i++){
    if(src[i] === '{') depth++;
    else if(src[i] === '}'){ depth--; if(depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('دالة غير مغلقة: ' + name);
}

const CODE = extractFn(SRC, 'buildTeacherDetail') + '\n;globalThis.buildTeacherDetail = buildTeacherDetail;';

const SUPERVISION_DAYS = [
  { key:'MONDAY', label:'الاثنين', dow:1 },
  { key:'TUESDAY', label:'الثلاثاء', dow:2 },
  { key:'WEDNESDAY', label:'الأربعاء', dow:3 },
  { key:'THURSDAY', label:'الخميس', dow:4 },
  { key:'FRIDAY', label:'الجمعة', dow:5 }
];

function buildCtx(env){
  const e = env || {};
  const db = e.db || { users:[], classes:[], notes:[], transfers:[], assignments:[], attendance:[], activities:[], students:[] };
  const ctx = {
    console,
    loadDB: () => db,
    userById: id => (db.users || []).find(u => u && u.id === id) || null,
    localDateKey: d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'),
    fmtTime: x => 'T:' + String(x),
    fmtDateOnly: x => 'D:' + String(x).slice(0, 10),
    classLabel: c => (c && (c.grade || c.classNo != null) ? 'فصل' : '—'),
    escapeHtml: s => String(s == null ? '' : s),
    studentIdsOf: t => t.studentIds || (t.studentId ? [t.studentId] : []),
    isActivityParticipant: () => false,
    activityTypes: [],
    tl: s => s,
    LATE_TYPE_NAMES: {},
    DL_EMPTY: '<li>EMPTY</li>',
    dlRow: (head, sub) => '<li>' + head + (sub ? ' | ' + sub : '') + '</li>',
    SUPERVISION_DAYS,
    __supervisionSchedule: e.sup || null,
    __supervisionToday: e.today || null
  };
  vm.createContext(ctx);
  vm.runInContext(CODE, ctx);
  return ctx;
}

const TEACHER_DB = {
  users: [
    { id:'t1', role:'TEACHER', name:'شادية' },
    { id:'t2', role:'TEACHER', name:'زميلة' },
    { id:'a1', role:'ADMIN', name:'المديرة' }
  ],
  classes: [
    { id:'c1', grade:'الأول', classNo:'1' },
    { id:'c2', grade:'الثاني', classNo:'2' }
  ],
  students: [ { id:'s1', fullName:'آمنة' }, { id:'s2', fullName:'خولة' } ],
  notes: [
    { id:'n1', createdBy:'t1', studentId:'s1', text:'ممتازة في التجويد', type:'POSITIVE', createdAt:'2026-10-20T08:00:00' },
    { id:'n2', createdBy:'t2', studentId:'s2', text:'ملاحظة زميلة', type:'NEGATIVE', createdAt:'2026-10-20T09:00:00' },
    { id:'n3', createdBy:'t1', studentId:'s1', text:'ملاحظة محذوفة', deleted:true, createdAt:'2026-10-19T08:00:00' }
  ],
  transfers: [
    { id:'tr1', createdBy:'t1', studentIds:['s1'], fromClassId:'c1', toClassId:'c2', status:'PENDING', createdAt:'2026-10-21T08:00:00' },
    { id:'tr2', createdBy:'t2', studentIds:['s2'], fromClassId:'c2', toClassId:'c1', status:'APPROVED', createdAt:'2026-10-21T09:00:00' }
  ],
  assignments: [
    { id:'a1', teacherId:'t1', classId:'c1', subject:'رياضيات', title:'واجب الطرح', date:'2026-10-25', created:2000 },
    { id:'a2', teacherId:'t1', classId:'c1', subject:'رياضيات', title:'تكليف محذوف', deleted:true, created:1000 },
    { id:'a3', teacherId:'t2', classId:'c2', subject:'علوم', title:'تكليف الزميلة', created:3000 }
  ],
  attendance: [],
  activities: []
};

test('ASSIGNMENTS: تكليفات المعلمة وحدها — لا تكليف زميلة ولا محذوف', () => {
  const ctx = buildCtx({ db: TEACHER_DB });
  const r = ctx.buildTeacherDetail('ASSIGNMENTS', 't1');
  assert.ok(r, 'النتيجة موجودة');
  assert.equal(r.title, 'التكليفات التي أنشأتها');
  assert.ok(r.html.includes('واجب الطرح'), 'تكليفها ظاهر');
  assert.ok(r.html.includes('D:2026-10-25'), 'تاريخ التسليم ظاهر');
  assert.ok(!r.html.includes('تكليف الزميلة'), 'تكليف الزميلة مخفي');
  assert.ok(!r.html.includes('تكليف محذوف'), 'المحذوف مخفي');
});

test('SUPERVISION: أيام الإشراف الأسبوعي للمعلمة + حالة اليوم (باشرت)', () => {
  const ctx = buildCtx({
    db: TEACHER_DB,
    sup: { schedule: [ { dayOfWeek:1, teacherId:'t1' }, { dayOfWeek:2, teacherId:'t2' }, { dayOfWeek:3, teacherId:'t1' } ] },
    today: { dayOfWeek:1, date:'2026-10-22', assigned:[ { teacherId:'t1', name:'شادية', checkedInAt:'07:35' }, { teacherId:'t2', name:'زميلة' } ] }
  });
  const r = ctx.buildTeacherDetail('SUPERVISION', 't1');
  assert.ok(r, 'النتيجة موجودة');
  assert.equal(r.title, 'موعد الإشراف (الأسبوعي)');
  assert.ok(r.html.includes('الاثنين'), 'يوم الاثنين (إشرافها) ظاهر');
  assert.ok(r.html.includes('الأربعاء'), 'يوم الأربعاء (إشرافها) ظاهر');
  assert.ok(!r.html.includes('الثلاثاء'), 'يوم الثلاثاء (إشراف الزميلة) مخفي');
  assert.ok(r.html.includes('باشرت'), 'حالة اليوم (باشرت) ظاهرة');
});

test('SUPERVISION: اليوم — غير مكلفة إذا لم يكن اسمها في مشرفات اليوم', () => {
  const ctx = buildCtx({
    db: TEACHER_DB,
    sup: { schedule: [ { dayOfWeek:4, teacherId:'t1' } ] },
    today: { dayOfWeek:1, date:'2026-10-22', assigned:[ { teacherId:'t2', name:'زميلة' } ] }
  });
  const r = ctx.buildTeacherDetail('SUPERVISION', 't1');
  assert.ok(r.html.includes('غير مكلفة اليوم'), 'حالة «غير مكلفة اليوم» ظاهرة');
  assert.ok(!r.html.includes('باشرت'), 'لا تظهر حالة مباشر زميلة');
});

test('SUPERVISION: بلا جدول محمّل ولا اليوم → EMPTY ودون خطأ', () => {
  const ctx = buildCtx({ db: TEACHER_DB });
  const r = ctx.buildTeacherDetail('SUPERVISION', 't1');
  assert.ok(r, 'لا يرمي خطأ');
  assert.ok(r.html.includes('EMPTY'), 'صف فارغ عند غياب البيانات');
});

test('NOTES: ملاحظات المعلمة وحدها — لا ملاحظة زميلة ولا محذوفة', () => {
  const ctx = buildCtx({ db: TEACHER_DB });
  const r = ctx.buildTeacherDetail('NOTES', 't1');
  assert.ok(r.html.includes('ممتازة في التجويد'), 'ملاحظتها ظاهرة');
  assert.ok(!r.html.includes('ملاحظة زميلة'), 'ملاحظة الزميلة مخفية');
  assert.ok(!r.html.includes('ملاحظة محذوفة'), 'المحذوفة مخفية');
});

test('TRANSFERS: طلبات التحويل التي أنشأتها وحدها', () => {
  const ctx = buildCtx({ db: TEACHER_DB });
  const r = ctx.buildTeacherDetail('TRANSFERS', 't1');
  assert.ok(r.html.includes('آمنة'), 'طالبتها ظاهرة');
  assert.ok(r.html.includes('قيد المراجعة'), 'الحالة ظاهرة');
  assert.ok(!r.html.includes('خولة'), 'تحويل الزميلة مخفي');
});

test('renderTeacherPage: بطاقات التحويلات والتكليفات والملاحظات والإشراف موصولة بنوعاتها', () => {
  const page = extractFn(SRC, 'renderTeacherPage');
  assert.ok(page.includes("'TRANSFERS'"), 'بطاقة التحويلات تفتح TRANSFERS');
  assert.ok(page.includes("'ASSIGNMENTS'"), 'بطاقة التكليفات تفتح ASSIGNMENTS');
  assert.ok(page.includes("'NOTES'"), 'بطاقة الملاحظات تفتح NOTES');
  assert.ok(page.includes("'SUPERVISION'"), 'بطاقة الإشراف تفتح SUPERVISION');
  assert.ok(page.includes('أعمال المعلمة'), 'عنوان القسم موجود');
});

test('renderTeacherPage: الفلاتر تستخدم حقول الملكية لا اسم الجلسة', () => {
  const page = extractFn(SRC, 'renderTeacherPage');
  assert.ok(page.includes('t.createdBy === user.id'), 'التحويلات تفلتر بـ createdBy');
  assert.ok(page.includes('a.teacherId === user.id'), 'التكليفات تفلتر بـ teacherId');
  assert.ok(page.includes('n.createdBy === user.id'), 'الملاحظات تفلتر بـ createdBy');
  assert.ok(page.includes('__loadSupervisionSchedule()'), 'يطلب جدول الإشراف من الخادم عند الحاجة');
});

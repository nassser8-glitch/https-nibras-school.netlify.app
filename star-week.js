'use strict';
// ============================================================================
// ⭐ نجمة الأسبوع — منطق نقي (بلا Express وبلا DB) ليبقى قابلًا للاختبار
// ----------------------------------------------------------------------------
// كل مصادر البيانات هنا *حقيقية ومستعملة فعلاً* في المشروع (لا schema موازٍ):
//   • الفصل        : schoolData.classes[]        = {id, name, gradeId, teacherIds[], removedTeacherIds[], deleted}
//   • معلّمات الفصل: classes[].teacherIds        (ملكية بالمعرّف لا بالاسم)
//   • جدول الحصص   : schoolData.timetable[teacherId][DAY_KEY][period] = {classId, subject, _del}
//   • الطالبة      : schoolData.students[]       = {id, fullName, classId, deleted}
//   • الأسبوع      : thisMonday() + academicStart (نفس دالة schoolWeekInfo في الواجهة)
// التخزين: قسم `stars` داخل JSON ‏school_data.data (مثل announcements/suggestions) → بلا migration.
// ============================================================================

// الصفحات الثابتة المسموح بها فقط. أي قيمة خارجها تُهمل (لا صفات عشوائية).
const STAR_TRAITS = [
  { id: 'mjthda',    emoji: '🌟', label: 'مجتهدة' },
  { id: 'mtaawna',   emoji: '🤝', label: 'متعاونة' },
  { id: 'khuluqa',   emoji: '🌷', label: 'خلوقة' },
  { id: 'mahbbaLt',  emoji: '📚', label: 'محبة للتعلم' },
  { id: 'masrwla',   emoji: '🎯', label: 'مسؤولة' },
  { id: 'multazma',  emoji: '⏰', label: 'ملتزمة' },
  { id: 'mbdea',     emoji: '💡', label: 'مبدعة' },
  { id: 'mtathditha',emoji: '🗣️', label: 'متحدثة جيدة' },
  { id: 'mbadara',   emoji: '❤️', label: 'مبادرة' },
  { id: 'zamila',    emoji: '👭', label: 'متعاونة مع زميلاتها' },
  { id: 'nadhafa',   emoji: '🧹', label: 'محافظة على النظافة' },
  { id: 'musharika', emoji: '🏆', label: 'متميّزة في المشاركة' }
];
const TRAIT_IDS = new Set(STAR_TRAITS.map(t => t.id));
const TRAIT_BY_ID = new Map(STAR_TRAITS.map(t => [t.id, t]));
const MAX_TRAITS = 6;
const MAX_MESSAGE = 140;

// مكتبات المدرسة: canonical موجود فعلاً في app_settings عبر /api/settings/:school
const SCHOOL_TZ_OFFSET_MIN = 300; // Asia/Karachi = +05:00 (بلا daylight saving)

function pad2(n){ return String(n).padStart(2, '0'); }
function ymd(d){ return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()); }

  // الأسبوع الحالي = نفس منطق schoolWeekInfo(): أقرب يوم اثنين (شاملًا اليوم الحالي)،
// فالمفتاح تاريخ ذلك الاثنين → ثابت لكل أسبوع ولا يعتمد على تسمية نصية تتغير.
function currentWeek(nowMs, tzOffsetMin){
  const off = tzOffsetMin == null ? SCHOOL_TZ_OFFSET_MIN : tzOffsetMin;
  const shifted = new Date(Number(nowMs == null ? Date.now() : nowMs) + off * 60000);
  const mon = new Date(shifted.getTime());
  mon.setUTCHours(0, 0, 0, 0);
  mon.setUTCDate(mon.getUTCDate() - ((mon.getUTCDay() + 6) % 7)); // 0=الاثنين
  const sun = new Date(mon.getTime());
  sun.setUTCDate(sun.getUTCDate() + 6);
  return { key: ymd(mon), start: ymd(mon), end: ymd(sun) };
}

// تسمية «الأسبوع N» بنفس حساب schoolWeekInfo ليبقى رقم الأسبوع مطابقًا للواجهة.
function weekLabel(week, academicStart){
  if (academicStart) {
    const s = new Date(String(academicStart).slice(0, 10) + 'T00:00:00Z');
    const m = new Date(week.key + 'T00:00:00Z');
    if (!isNaN(s.getTime()) && !isNaN(m.getTime())) {
      const diff = Math.floor((m.getTime() - s.getTime()) / (7 * 24 * 3600 * 1000));
      const n = diff + 1;
      if (n >= 1) return 'الأسبوع ' + n;
    }
  }
  return 'أسبوع ' + week.key;
}

function listClasses(schoolData){
  return (schoolData && Array.isArray(schoolData.classes)) ? schoolData.classes : [];
}
function listStudents(schoolData){
  return (schoolData && Array.isArray(schoolData.students)) ? schoolData.students : [];
}
function findClass(schoolData, classId){
  if (!classId) return null;
  const c = listClasses(schoolData).find(x => x && x.id === classId);
  if (!c || c.deleted) return null;
  return c;
}
function findStudent(schoolData, studentId){
  if (!studentId) return null;
  const s = listStudents(schoolData).find(x => x && x.id === studentId);
  if (!s || s.deleted) return null;
  return s;
}
function findUser(schoolData, userId){
  if (!userId) return null;
  const u = ((schoolData && Array.isArray(schoolData.users)) ? schoolData.users : []).find(x => x && x.id === userId);
  return u || null;
}
function sessionUserId(session){
  return session && (session.user_id || session.id) || '';
}
function userName(userId, schoolData){
  const u = findUser(schoolData, userId);
  return (u && (u.name || u.fullName)) || '';
}
function classTitle(classId, schoolData){
  const c = findClass(schoolData, classId);
  if (!c) return '';
  const g = ((schoolData && Array.isArray(schoolData.grades)) ? schoolData.grades : [])
    .find(x => x && x.id === c.gradeId);
  return (g ? g.name + ' — ' : '') + (c.name || '');
}

// عدد الحصص التدريسية لكل معلمة في فصل معيّن، من جدول الحصص الحقيقي.
// الخانة المحذوفة (_del) لا تُحتسب. النتيجة Map(userId -> periods).
function periodCountsForClass(schoolData, classId){
  const counts = new Map();
  const tt = (schoolData && schoolData.timetable) || {};
  if (!classId) return counts;
  for (const teacherId of Object.keys(tt)){
    const days = tt[teacherId];
    if (!days || typeof days !== 'object') continue;
    let n = 0;
    for (const dayKey of Object.keys(days)){
      const day = days[dayKey];
      if (!day || typeof day !== 'object') continue;
      for (const period of Object.keys(day)){
        const cell = day[period];
        if (!cell || typeof cell !== 'object') continue;
        if (cell._del) continue;                 // خانة محذوفة
        if (cell.classId !== classId) continue;  // ليست في هذا الفصل
        n++;
      }
    }
    if (n > 0) counts.set(teacherId, n);
  }
  return counts;
}

// مرشّحات الفصل: من ملكية الفصل (teacherIds) ومن يدرّسه فعلاً (الجدول)،
// مع استبعاد المحذوفين والمعطّلين ومن هم في قائمة الإزالة.
function classCandidates(schoolData, classId){
  const cls = findClass(schoolData, classId);
  if (!cls) return [];
  const removed = new Set(Array.isArray(cls.removedTeacherIds) ? cls.removedTeacherIds : []);
  const owned = (Array.isArray(cls.teacherIds) ? cls.teacherIds : []).filter(id => id && !removed.has(id));
  const counts = periodCountsForClass(schoolData, classId);
  const fromTimetable = [...counts.keys()].filter(id => !removed.has(id));
  const ids = [];
  for (const id of owned.concat(fromTimetable)) if (!ids.includes(id)) ids.push(id);
  return ids.map(id => {
    const u = findUser(schoolData, id);
    return {
      id,
      name: (u && (u.name || u.fullName)) || '',
      role: (u && u.role) || '',
      active: !!(u && !u.deleted && u.active !== false),
      exists: !!u && !u.deleted,
      periods: counts.get(id) || 0,
      fromTimetable: counts.has(id),
      // هل نصّحتها المدرسة صاحبة هذا الفصل؟ وترتيبها كما أُدخلت (للرجوع الحتمي)
      fromOwnership: owned.indexOf(id) >= 0,
      order: owned.indexOf(id)
    };
  }).filter(c => c.exists);
}

// رائدة الفصل = معلمة الفصل المُسندة إليه رسميًا (teacherIds) الأكثر حصصًا.
//
// teacherIds هي تعبير المدرسة عن «معلمات الفصل» (نفس ما تعتمده لوحة المعلمة
// والجدول)، فلا يجوز لمعلمة *غير مُسندة* للفصل أن تسلب الرائدية مهما بلغت
// حصصها. لذلك القاعدة:
// 1) إن وُجد إسناد فعّال: المرشّحات هنّ المُسندات فقط، وتفوز الأكثر حصصًا؛
//    وعند غياب أي حصص مسجّلة يرجّح ترتيب الإسناد (معلومة المدرسة).
// 2) إن لم يوجد إسناد: الرجوع إلى الجدول وحده.
// 3) النتيجة حتمية دائمًا: لا عشوائية، ولا تتغيّر بترتيب مفاتيح الكائنات،
//    ولا تطلب أي تدخل إداري.
function classOwner(schoolData, classId){
  const cls = findClass(schoolData, classId);
  if (!cls) return null;
  const all = classCandidates(schoolData, classId);
  if (!all.length) return { classId, ownerId: null, ownerName: '', periods: 0, tie: false, source: 'none', candidates: [] };
  // المفعّلة أولاً: منح الصلاحية لحساب معطّل بلا فائدة. إن لم تكن هناك مفعّلة نستخدم الجميع.
  const active = all.filter(c => c.active);
  const pool = active.length ? active : all;
  const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

  const assigned = pool.filter(c => c.fromOwnership);
  const scoped = assigned.length ? assigned : pool;
  const source = assigned.length ? 'assigned' : 'timetable';

  // الأكثر حصصًا؛ وعند التساوي المعرّف الأصغر ⇒ مستقل عن ترتيب المدخلات.
  const ranked = scoped.slice().sort((a, b) => (b.periods - a.periods) || byId(a, b));
  const anyRecorded = ranked.some(c => c.periods > 0);
  let top = ranked[0];
  if (!anyRecorded && assigned.length){
    // لا حصص مسجّلة: يُرجّح ترتيب الإسناد كما أدخلته المدرسة.
    top = assigned.slice().sort((a, b) => a.order - b.order || byId(a, b))[0];
  }
  const tied = ranked.filter(c => c.periods === top.periods);
  return {
    classId,
    ownerId: top.id,
    ownerName: top.name,
    periods: top.periods,
    tie: anyRecorded && tied.length > 1,
    source,                       // 'assigned' | 'timetable' | 'none'
    candidates: pool.map(c => ({ id: c.id, name: c.name, periods: c.periods, active: c.active, assigned: c.fromOwnership }))
  };
}

// رائدة الفصل من زاوية *المستخدم*: الفصول التي هو رائدها فعلًا.
function ownedClassIds(schoolData, userId){
  return listClasses(schoolData)
    .filter(c => c && !c.deleted)
    .map(c => classOwner(schoolData, c.id))
    .filter(o => o && o.ownerId === userId)
    .map(o => o.classId);
}

function sanitizeTraits(list){
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const raw of list){
    const id = typeof raw === 'string' ? raw : (raw && raw.id);
    if (typeof id !== 'string') continue;
    if (!TRAIT_IDS.has(id)) continue;   // قيمة غير صالحة → تُهمل بصمت
    if (out.includes(id)) continue;     // لا تكرار
    out.push(id);
    if (out.length >= MAX_TRAITS) break;
  }
  return out;
}
function traitLabel(id){
  const t = TRAIT_BY_ID.get(id);
  return t ? t.emoji + ' ' + t.label : '';
}
function sanitizeMessage(msg){
  if (typeof msg !== 'string') return '';
  return msg.replace(/\s+/g, ' ').trim().slice(0, MAX_MESSAGE);
}

// معرّف فريد حتمي لكل أسبوع داخل school_data الخاص بالمدرسة.
function awardId(weekKey){ return String(weekKey); }

function listAwards(schoolData){
  const stars = schoolData && schoolData.stars;
  return Array.isArray(stars) ? stars.filter(x => x && typeof x === 'object' && x.id) : [];
}
function awardFor(schoolData, weekKey, classId){
  return listAwards(schoolData).find(a => a.weekKey === weekKey && (!classId || a.classId === classId)) || null;
}

// ── التحقق الكامل قبل الحفظ (كل الصلاحيات هنا، لا في الواجهة) ───────────────
class StarError extends Error {
  constructor(code, status){ super(code); this.code = code; this.status = status || 400; }
}

function validateAward(schoolData, session, body, week){
  const role = session && session.role;
  if (!session || !sessionUserId(session)) throw new StarError('unauthenticated', 401);
  if (role !== 'ADMIN') throw new StarError('forbidden', 403);

  const classId = body && body.classId;
  const cls = findClass(schoolData, classId);
  if (!cls) throw new StarError('bad_class', 400);

  // تتحقق صلاحية الفصل والطالبة من نسخة بيانات المدرسة على الخادم.
  const student = findStudent(schoolData, body && body.studentId);
  if (!student) throw new StarError('bad_student', 400);
  if (student.classId !== classId) throw new StarError('student_not_in_class', 400);

  const traits = sanitizeTraits(body && body.traits);
  if (!traits.length) throw new StarError('bad_traits', 400);

  return { classId, student, traits, message: sanitizeMessage(body && body.message) };
}

// يبني سجل النجمة ويحفظه. teacherId المشتق من الخادم فقط:
//   • الإدارة تُدخل نيابةً عن رائدة الصف ⇒ يُسجَّل باسم الرائدة.
//   • إن لم يكن للفصل رائدة (نادر) ⇒ يُسجَّل باسم من أدخل.
function upsertAward(schoolData, session, body, opts){
  const nowMs = (opts && opts.nowMs) != null ? opts.nowMs : Date.now();
  const week = (opts && opts.week) || currentWeek(nowMs);
  const checked = validateAward(schoolData, session, body, week);

  const previous = listAwards(schoolData);
  const existing = previous.find(a => a.weekKey === week.key) || null;
  const stars = previous.filter(a => a.weekKey !== week.key);
  const id = awardId(week.key);

  const record = {
    id,
    weekKey: week.key,
    weekStart: week.start,
    weekEnd: week.end,
    classId: checked.classId,
    studentId: checked.student.id,
    studentName: checked.student.fullName || '',
    traits: checked.traits,
    message: checked.message,
    teacherId: sessionUserId(session),
    teacherName: userName(sessionUserId(session), schoolData),
    createdAt: existing && existing.createdAt ? existing.createdAt : new Date(nowMs).toISOString(),
    updatedAt: new Date(nowMs).toISOString()
  };
  stars.push(record);
  return { record, stars, week };
}

// عرض آمن: لا حقول حساسة، ولا بيانات خارج الفصول المسموح بها للمُرسِل.
function publicAward(schoolData, a){
  return {
    id: a.id, weekKey: a.weekKey, weekStart: a.weekStart, weekEnd: a.weekEnd,
    classId: a.classId, className: classTitle(a.classId, schoolData),
    studentId: a.studentId,
    studentName: (findStudent(schoolData, a.studentId) || {}).fullName || a.studentName || '',
    traits: sanitizeTraits(a.traits), traitsLabels: sanitizeTraits(a.traits).map(traitLabel),
    message: sanitizeMessage(a.message),
    teacherId: a.teacherId, teacherName: a.teacherName,
    createdAt: a.createdAt, updatedAt: a.updatedAt
  };
}
function isManagerRole(role){ return role === 'ADMIN'; }
function isStarManagerRole(role){ return role === 'ADMIN'; }

// يعرض نجمة المدرسة الحالية لكل دور موثّق، ويقتصر نموذج الإدارة على ADMIN.
function buildView(schoolData, session, week, opts){
  const role = session && session.role;
  const manager = isManagerRole(role);
  const all = listAwards(schoolData);
  const current = all.filter(a => a.weekKey === week.key)
    .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
  const visible = current.slice(0, 1);

  const owners = manager
    ? listClasses(schoolData).filter(c => c && !c.deleted).map(c => {
        const o = classOwner(schoolData, c.id) || { ownerId: null, ownerName: '', periods: 0, tie: false, source: 'none', candidates: [] };
        return {
          classId: c.id, className: classTitle(c.id, schoolData),
          ownerId: o.ownerId, ownerName: o.ownerName, periods: o.periods, tie: !!o.tie,
          source: o.source || 'none',   // assigned | timetable | none
          // تشخيص: معلمات الفصل المُسندات وأسماؤهن وحصصهن (للمديرة فقط)
          assigned: (o.candidates || []).filter(x => x.assigned)
            .map(x => ({ id: x.id, name: x.name, periods: x.periods }))
        };
      })
    : [];

  const history = manager
    ? all.slice().sort((a, b) => (a.weekKey < b.weekKey ? 1 : a.weekKey > b.weekKey ? -1 : 0))
        .map(a => publicAward(schoolData, a))
    : [];

  const userId = sessionUserId(session);
  const owned = (role === 'STUDENT' || manager) ? [] : ownedClassIds(schoolData, userId);
  const ownedClasses = (role === 'STUDENT' || manager) ? [] : owned.map(id => ({ id, name: classTitle(id, schoolData) }));
  // تشخيص للمعلمة: الفصول التي هي مُدرجة فيها صراحةً (teacherIds) داخل مدرستها.
  const assignedClassIds = listClasses(schoolData).filter(c =>
    c && !c.deleted && Array.isArray(c.teacherIds) && c.teacherIds.includes(userId)
  ).map(c => c.id);

  return {
    week: { key: week.key, start: week.start, end: week.end, label: week.label },
    stars: visible.map(a => publicAward(schoolData, a)),
    owners, history,
    classes: manager ? listClasses(schoolData).filter(c => c && !c.deleted).map(c => ({
      id: c.id, name: classTitle(c.id, schoolData)
    })) : [],
    students: manager ? listStudents(schoolData).filter(s => s && !s.deleted).map(s => ({
      id: s.id, fullName: s.fullName || s.name || s.id, classId: s.classId
    })) : [],
    me: {
      id: userId, role, isManager: manager, school: session.school || null,
      name: userName(userId, schoolData), userExists: !!findUser(schoolData, userId),
      ownedClassIds: owned, ownedClasses, assignedClassIds
    }
  };
}

module.exports = {
  STAR_TRAITS, TRAIT_IDS, MAX_TRAITS, MAX_MESSAGE, SCHOOL_TZ_OFFSET_MIN,
  currentWeek, weekLabel, periodCountsForClass, classCandidates, classOwner, ownedClassIds,
  sanitizeTraits, sanitizeMessage, traitLabel, awardId, listAwards, awardFor,
  validateAward, upsertAward, publicAward, buildView, classTitle, findClass, findStudent, findUser, userName, sessionUserId,
  StarError
};

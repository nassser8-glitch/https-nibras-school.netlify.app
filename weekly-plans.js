'use strict';

// منطق الخطة الأسبوعية المشترك (تحقق، تجميع موحد للطلاب، إحصائيات التغطية، وأمان المرفقات)
const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024; // 3 MB

const WEEK_DAYS = [
  { key: 'mon', label: 'الإثنين', offset: 1 },
  { key: 'tue', label: 'الثلاثاء', offset: 2 },
  { key: 'wed', label: 'الأربعاء', offset: 3 },
  { key: 'thu', label: 'الخميس', offset: 4 },
  { key: 'fri', label: 'الجمعة', offset: 5 },
];
const DAY_KEY_SET = new Set(WEEK_DAYS.map(d => d.key));
const PLAN_STATUSES = ['draft', 'published'];

function normalizeDateStr(val) {
  const s = String(val == null ? '' : val).trim();
  if (!s) return '';
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m ? m[1] : '';
}

function currentSundayKey(nowInput) {
  const d = nowInput ? new Date(nowInput) : new Date(Date.now() + 5 * 3600 * 1000);
  const utcDay = d.getUTCDay(); // 0 = Sun, 5 = Fri, 6 = Sat
  // في الإجازة (الجمعة/السبت) أو أيام الدراسة (الأحد-الخميس) نرجع بداية الأسبوع الدراسي (الأحد)
  const sun = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - utcDay));
  return sun.toISOString().slice(0, 10);
}

function sundayOfDateStr(val) {
  const s = normalizeDateStr(val);
  if (!s) return '';
  const t = Date.parse(s + 'T00:00:00Z');
  if (!Number.isFinite(t)) return s;
  const d = new Date(t);
  const sun = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - d.getUTCDay()));
  return sun.toISOString().slice(0, 10);
}

function weekDateForDay(weekStart, dayKey) {
  const ws = sundayOfDateStr(weekStart) || normalizeDateStr(weekStart);
  if (dayKey === 'sun') return ws;
  const day = WEEK_DAYS.find(d => d.key === dayKey);
  if (!ws || !day) return '';
  const base = Date.parse(ws + 'T00:00:00Z');
  if (!Number.isFinite(base)) return '';
  return new Date(base + day.offset * 86400000).toISOString().slice(0, 10);
}

function sanitizeAttachment(att) {
  if (!att || !att.data) return { ok: true, name: '', type: '', data: '' };
  const data = String(att.data || '').trim();
  const m = /^data:(image\/(?:png|jpeg|jpg|webp|gif)|application\/pdf);base64,([A-Za-z0-9+/=]+)$/i.exec(data);
  if (!m) return { ok: false, error: 'unsupported_attachment_type' };
  const approxBytes = Math.floor((m[2].length * 3) / 4);
  if (approxBytes > MAX_ATTACHMENT_BYTES) return { ok: false, error: 'attachment_too_large' };
  return {
    ok: true,
    name: String(att.name || 'attachment').trim().slice(0, 180),
    type: m[1].toLowerCase(),
    data,
  };
}

function sanitizeLinks(rawLinks) {
  const arr = Array.isArray(rawLinks)
    ? rawLinks
    : String(rawLinks || '').split(/\r?\n|,/).map(x => x.trim()).filter(Boolean);
  const out = [];
  for (const raw of arr) {
    const u = String(raw || '').trim();
    if (!u) continue;
    if (/^https?:\/\/\S+$/i.test(u)) out.push(u.slice(0, 500));
    if (out.length >= 10) break;
  }
  return out;
}

function validatePlanItem(raw, idx, weekStart) {
  const it = raw || {};
  const rawDay = String(it.dayKey || 'mon').trim().toLowerCase();
  if (!DAY_KEY_SET.has(rawDay)) return { ok: false, error: 'invalid_day_key' };
  const dayKey = rawDay;
  const id = String(it.id || ('wpi_' + (idx + 1))).trim().slice(0, 64);
  const date = normalizeDateStr(it.date) || weekDateForDay(weekStart, dayKey);
  const lesson = String(it.lesson || '').trim().slice(0, 500);
  const homework = String(it.homework || '').trim().slice(0, 500);
  const assessments = String(it.assessments || '').trim().slice(0, 500);
  const notes = String(it.notes || '').trim().slice(0, 1000);
  const links = sanitizeLinks(it.links);
  const att = sanitizeAttachment(it.attachment || (it.attachmentData ? {
    name: it.attachmentName, type: it.attachmentType, data: it.attachmentData,
  } : null));
  if (!att.ok) return { ok: false, error: att.error };
  return {
    ok: true,
    value: {
      id,
      dayKey,
      date,
      lesson,
      homework,
      assessments,
      notes,
      links,
      attachmentName: att.name,
      attachmentType: att.type,
      attachmentData: att.data,
    },
  };
}

function validateWeeklyPlanPayload(body) {
  const b = body || {};
  const classId = String(b.classId || '').trim();
  if (!classId) return { ok: false, error: 'class_required' };
  const subject = String(b.subject || '').trim().slice(0, 120);
  if (!subject) return { ok: false, error: 'subject_required' };
  const weekStart = sundayOfDateStr(b.weekStart) || currentSundayKey();
  const weekLabel = String(b.weekLabel || '').trim().slice(0, 100);
  const title = String(b.title || '').trim().slice(0, 200);
  const status = PLAN_STATUSES.includes(b.status) ? b.status : 'draft';
  const rawItems = Array.isArray(b.items) ? b.items : [];
  if (rawItems.length > 60) return { ok: false, error: 'too_many_items' };

  const items = [];
  for (let i = 0; i < rawItems.length; i++) {
    const v = validatePlanItem(rawItems[i], i, weekStart);
    if (!v.ok) return { ok: false, error: v.error };
    const x = v.value;
    if (x.lesson || x.homework || x.assessments || x.notes || x.links.length || x.attachmentData) {
      items.push(x);
    }
  }
  return {
    ok: true,
    value: {
      classId,
      subject,
      weekStart,
      weekLabel,
      title,
      status,
      items,
    },
  };
}

function extractTeacherAssignments(schoolData, teacherId) {
  const d = schoolData || {};
  const tid = String(teacherId || '').trim();
  const classIds = new Set();
  const pairsMap = {};
  const classes = Array.isArray(d.classes) ? d.classes.filter(c => c && !c.deleted) : [];
  const validClassSet = new Set(classes.map(c => String(c.id)));

  for (const c of classes) {
    if (Array.isArray(c.teacherIds) && c.teacherIds.map(String).includes(tid)) {
      classIds.add(String(c.id));
    }
  }
  const tt = (d.timetable && d.timetable[tid]) || {};
  for (const day of Object.values(tt)) {
    for (const cell of Object.values(day || {})) {
      if (!cell || cell._del || !cell.classId) continue;
      const cid = String(cell.classId);
      if (!validClassSet.has(cid)) continue;
      classIds.add(cid);
      const sub = String(cell.subject || '').trim();
      if (sub) {
        const key = cid + '|' + sub;
        if (!pairsMap[key]) pairsMap[key] = { classId: cid, subject: sub, teacherId: tid };
      }
    }
  }
  return { classIds, pairs: Object.values(pairsMap) };
}

function extractClassExpectedSubjects(schoolData, classId) {
  const d = schoolData || {};
  const cid = String(classId || '');
  const userMap = {};
  (Array.isArray(d.users) ? d.users : []).forEach(u => { if (u && u.id) userMap[String(u.id)] = u; });
  const pairsMap = {};
  for (const [tid, tt] of Object.entries(d.timetable || {})) {
    for (const day of Object.values(tt || {})) {
      for (const cell of Object.values(day || {})) {
        if (!cell || cell._del || String(cell.classId || '') !== cid) continue;
        const sub = String(cell.subject || '').trim();
        if (!sub) continue;
        const key = sub + '|' + tid;
        if (!pairsMap[key]) {
          pairsMap[key] = {
            classId: cid,
            subject: sub,
            teacherId: String(tid),
            teacherName: (userMap[String(tid)] && userMap[String(tid)].name) || '',
          };
        }
      }
    }
  }
  return Object.values(pairsMap);
}

function stripPlanAttachments(plan) {
  if (!plan) return plan;
  return Object.assign({}, plan, {
    items: (Array.isArray(plan.items) ? plan.items : []).map(it => ({
      id: it.id,
      dayKey: it.dayKey,
      date: it.date || '',
      lesson: it.lesson || '',
      homework: it.homework || '',
      assessments: it.assessments || '',
      notes: it.notes || '',
      links: Array.isArray(it.links) ? it.links : [],
      attachmentName: it.attachmentName || '',
      attachmentType: it.attachmentType || '',
      hasAttachment: !!it.attachmentData,
    })),
  });
}

function aggregateUnifiedStudentPlan(plans, classId, weekStart) {
  const cid = String(classId || '');
  const wsSun = sundayOfDateStr(weekStart);
  const matching = (Array.isArray(plans) ? plans : []).filter(p =>
    p &&
    p.status === 'published' &&
    String(p.classId) === cid &&
    (!wsSun || sundayOfDateStr(p.weekStart) === wsSun)
  );
  const tasks = [];
  const subjectsSet = new Set();
  for (const p of matching) {
    for (const it of (Array.isArray(p.items) ? p.items : [])) {
      if (!DAY_KEY_SET.has(it.dayKey)) continue;
      subjectsSet.add(p.subject);
      tasks.push({
        source: 'plan',
        planId: p.id,
        itemId: it.id,
        classId: p.classId,
        weekStart: p.weekStart,
        weekLabel: p.weekLabel || '',
        planTitle: p.title || '',
        subject: p.subject,
        teacherId: p.teacherId,
        teacherName: p.teacherName || '',
        dayKey: it.dayKey,
        date: it.date || weekDateForDay(p.weekStart, it.dayKey),
        lesson: it.lesson || '',
        homework: it.homework || '',
        assignmentText: '',
        assessments: it.assessments || '',
        notes: it.notes || '',
        links: Array.isArray(it.links) ? it.links : [],
        attachmentName: it.attachmentName || '',
        attachmentType: it.attachmentType || '',
        hasAttachment: !!(it.hasAttachment || it.attachmentData),
      });
    }
  }
  const dayOrder = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4 };
  tasks.sort((a, b) => {
    const da = dayOrder[a.dayKey] != null ? dayOrder[a.dayKey] : 9;
    const db = dayOrder[b.dayKey] != null ? dayOrder[b.dayKey] : 9;
    if (da !== db) return da - db;
    const subCmp = String(a.subject || '').localeCompare(String(b.subject || ''), 'ar');
    if (subCmp !== 0) return subCmp;
    return String(a.teacherName || '').localeCompare(String(b.teacherName || ''), 'ar');
  });
  return {
    plans: matching,
    tasks,
    subjects: Array.from(subjectsSet).sort((a, b) => a.localeCompare(b, 'ar')),
  };
}

function dayKeyOfIsoDate(dateStr) {
  const s = normalizeDateStr(dateStr);
  if (!s) return '';
  const t = Date.parse(s + 'T00:00:00Z');
  if (!Number.isFinite(t)) return '';
  const map = { 1: 'mon', 2: 'tue', 3: 'wed', 4: 'thu', 5: 'fri' };
  return map[new Date(t).getUTCDay()] || '';
}

function extractClassAssignmentsForWeek(schoolData, classId, weekStart, studentId) {
  const d = schoolData || {};
  const cid = String(classId || '');
  const wsSun = sundayOfDateStr(weekStart);
  const userMap = {};
  (Array.isArray(d.users) ? d.users : []).forEach(u => { if (u && u.id) userMap[String(u.id)] = u.name || ''; });

  const tasks = [];
  const subjectsSet = new Set();
  const seenIds = new Set();
  const completedKeys = {};

  for (const a of (Array.isArray(d.assignments) ? d.assignments : [])) {
    if (!a || a.deleted || !a.id) continue;
    if (String(a.classId || '') !== cid) continue;
    const aid = String(a.id);
    if (seenIds.has(aid)) continue;
    const aDate = normalizeDateStr(a.date);
    if (!aDate) continue;
    if (wsSun && sundayOfDateStr(aDate) !== wsSun) continue;
    const dayKey = dayKeyOfIsoDate(aDate);
    if (!DAY_KEY_SET.has(dayKey)) continue; // يستبعد السبت والأحد
    seenIds.add(aid);
    const sub = String(a.subject || 'تكليف').trim();
    subjectsSet.add(sub);
    const planId = 'assign_' + aid;
    if (studentId && Array.isArray(a.completedBy) && a.completedBy.map(String).includes(String(studentId))) {
      completedKeys[planId + '|' + aid] = true;
    }
    const typeLabel = a.type ? (a.type + ': ') : 'تكليف: ';
    tasks.push({
      source: 'assignment',
      assignmentId: aid,
      planId,
      itemId: aid,
      classId: cid,
      weekStart: wsSun || sundayOfDateStr(aDate),
      weekLabel: '',
      planTitle: a.title || '',
      subject: sub,
      teacherId: String(a.teacherId || ''),
      teacherName: a.teacherName || userMap[String(a.teacherId || '')] || '',
      dayKey,
      date: aDate,
      lesson: '',
      homework: '',
      assignmentText: typeLabel + String(a.title || 'بدون عنوان'),
      assessments: '',
      notes: '',
      links: [],
      attachmentName: '',
      attachmentType: '',
      hasAttachment: false,
    });
  }
  return { tasks, subjects: Array.from(subjectsSet), completedKeys };
}

function buildAdminCoverageSummary(schoolData, plans, weekStart) {
  const d = schoolData || {};
  const ws = normalizeDateStr(weekStart);
  const classes = (Array.isArray(d.classes) ? d.classes : []).filter(c => c && !c.deleted);
  const grades = Array.isArray(d.grades) ? d.grades : [];
  const gradeMap = {};
  grades.forEach(g => { if (g && g.id) gradeMap[String(g.id)] = g.name; });
  const users = (Array.isArray(d.users) ? d.users : []).filter(u => u && u.role === 'TEACHER' && u.active !== false && !u.deleted);

  const wsSun = sundayOfDateStr(weekStart);
  const weekPublished = (Array.isArray(plans) ? plans : []).filter(p =>
    p && p.status === 'published' && (!wsSun || sundayOfDateStr(p.weekStart) === wsSun)
  );
  const pubByTeacher = new Set(weekPublished.map(p => String(p.teacherId)));
  const pubByClass = {};
  const pubKeys = new Set();
  for (const p of weekPublished) {
    const cid = String(p.classId);
    if (!pubByClass[cid]) pubByClass[cid] = { plans: 0, tasks: 0, subjects: [] };
    pubByClass[cid].plans++;
    pubByClass[cid].tasks += Array.isArray(p.items) ? p.items.length : 0;
    if (!pubByClass[cid].subjects.includes(p.subject)) pubByClass[cid].subjects.push(p.subject);
    pubKeys.add(cid + '|' + p.subject + '|' + String(p.teacherId));
  }

  const assignedTeachers = users.filter(t => extractTeacherAssignments(d, t.id).classIds.size > 0);
  const teachersPublished = assignedTeachers.filter(t => pubByTeacher.has(String(t.id)));
  const teachersPending = assignedTeachers.filter(t => !pubByTeacher.has(String(t.id)));

  const classRows = classes.map(c => {
    const expected = extractClassExpectedSubjects(d, c.id);
    const stat = pubByClass[String(c.id)] || { plans: 0, tasks: 0, subjects: [] };
    const completedSubjects = expected.filter(e => pubKeys.has(String(c.id) + '|' + e.subject + '|' + e.teacherId));
    const missingSubjects = expected.filter(e => !pubKeys.has(String(c.id) + '|' + e.subject + '|' + e.teacherId));
    return {
      classId: c.id,
      className: (gradeMap[String(c.gradeId)] ? gradeMap[String(c.gradeId)] + ' — ' : '') + 'فصل ' + c.name,
      publishedPlans: stat.plans,
      publishedTasks: stat.tasks,
      publishedSubjects: stat.subjects,
      expectedCount: expected.length,
      completedCount: completedSubjects.length,
      missingSubjects,
    };
  });

  return {
    totalClasses: classes.length,
    classesWithPlans: classRows.filter(r => r.publishedPlans > 0).length,
    teachersPublished: teachersPublished.map(t => ({ id: t.id, name: t.name })),
    teachersPending: teachersPending.map(t => ({ id: t.id, name: t.name })),
    completedMaterialsCount: classRows.reduce((s, r) => s + r.completedCount, 0),
    pendingMaterialsCount: classRows.reduce((s, r) => s + r.missingSubjects.length, 0),
    totalPublishedTasks: classRows.reduce((s, r) => s + r.publishedTasks, 0),
    classRows,
  };
}

module.exports = {
  MAX_ATTACHMENT_BYTES,
  WEEK_DAYS,
  PLAN_STATUSES,
  normalizeDateStr,
  currentSundayKey,
  sundayOfDateStr,
  weekDateForDay,
  sanitizeAttachment,
  sanitizeLinks,
  validatePlanItem,
  validateWeeklyPlanPayload,
  extractTeacherAssignments,
  extractClassExpectedSubjects,
  stripPlanAttachments,
  aggregateUnifiedStudentPlan,
  dayKeyOfIsoDate,
  extractClassAssignmentsForWeek,
  buildAdminCoverageSummary,
};

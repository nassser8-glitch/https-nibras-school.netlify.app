'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const ann = require(path.join(ROOT, 'school-announcements.js'));
const db = require(path.join(ROOT, 'db.js'));
const serverSrc = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const indexSrc = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

const sampleGrades = [
  { id: 'g1', name: 'الأول الابتدائي' },
  { id: 'g2', name: 'الثاني المتوسط' },
  { id: 'g3', name: 'الأول الثانوي' },
];
const sampleClasses = [
  { id: 'c1', gradeId: 'g1', name: 'أ' },
  { id: 'c2', gradeId: 'g2', name: 'ب' },
  { id: 'c3', gradeId: 'g3', name: 'أ' },
];
const sampleStudents = [
  { id: 's1', name: 'أحمد', classId: 'c1' },
  { id: 's2', name: 'خالد', classId: 'c2' },
  { id: 's3', name: 'سعد', classId: 'c3' },
  { id: 's4', name: 'عمر', classId: 'c2' },
];

test('1. إنشاء إعلان ونشره والتحقق من صحة المدخلات والمرفقات', () => {
  const bad = ann.validateAnnouncementPayload({ title: '   ' });
  assert.equal(bad.ok, false);
  assert.equal(bad.error, 'title_required');

  const badRange = ann.validateAnnouncementPayload({
    title: 'إعلان',
    startDate: '2026-12-10',
    endDate: '2026-12-01',
  });
  assert.equal(badRange.ok, false);
  assert.equal(badRange.error, 'invalid_date_range');

  const badAtt = ann.validateAnnouncementPayload({
    title: 'مرفق غير مسموح',
    attachment: { name: 'x.svg', type: 'image/svg+xml', data: 'data:image/svg+xml;base64,PHN2Zz4=' },
  });
  assert.equal(badAtt.ok, false);
  assert.equal(badAtt.error, 'unsupported_attachment_type');

  const valid = ann.validateAnnouncementPayload({
    title: 'إعلان بداية الاختبارات',
    body: '**تنبيه** مهم للجميع',
    category: 'urgent',
    pinned: true,
    status: 'published',
    targetType: 'all',
    startDate: '2026-11-20',
    endDate: '2026-11-30',
    attachment: { name: 'schedule.pdf', type: 'application/pdf', data: 'data:application/pdf;base64,JVBERi0xLjQ=' },
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.value.category, 'urgent');
  assert.equal(valid.value.pinned, true);
  assert.equal(valid.value.status, 'published');
  assert.equal(valid.value.attachmentType, 'application/pdf');
});

test('2. ظهور الإعلان في حساب الطالب واللوحة الرئيسية', () => {
  assert.match(indexSrc, /renderStudentAnnouncementsBanner\(\)/);
  assert.match(indexSrc, /ann-indicator-glow/);
  assert.match(indexSrc, /ann-bell-count/);
  assert.match(indexSrc, /ann-new-pill/);
  assert.match(serverSrc, /session\.user_id \|\| session\.userId/);
  assert.match(indexSrc, /href:'#\/school-announcements'/);
  assert.match(indexSrc, /renderSchoolAnnouncementsStudent\(\)/);
  assert.match(indexSrc, /renderSchoolAnnouncementsAdmin\(\)/);
  assert.doesNotMatch(indexSrc, /فتح الإعلانات/);
  assert.doesNotMatch(indexSrc, /أحدث إعلانات المدرسة/);
  assert.doesNotMatch(indexSrc, /عرض جميع الإعلانات/);
  assert.match(indexSrc, /seenIds\.has\(a\.id\)/);

  const a = { status: 'published', targetType: 'all', startDate: '2026-11-20', endDate: '2026-11-30' };
  assert.equal(ann.isAnnouncementActiveOnDate(a, '2026-11-22'), true);
  const targeted = ann.resolveTargetedStudents(a, sampleStudents, sampleGrades, sampleClasses);
  assert.equal(targeted.length, 4);
});

test('3. تخصيص إعلان لفصل معين واستهداف المراحل', () => {
  const classAnn = { status: 'published', targetType: 'class', targetValue: 'c2' };
  const targetedClass = ann.resolveTargetedStudents(classAnn, sampleStudents, sampleGrades, sampleClasses);
  assert.deepEqual(targetedClass.map(s => s.id), ['s2', 's4']);

  const primaryAnn = { status: 'published', targetType: 'primary' };
  const targetedPrimary = ann.resolveTargetedStudents(primaryAnn, sampleStudents, sampleGrades, sampleClasses);
  assert.deepEqual(targetedPrimary.map(s => s.id), ['s1']);

  const middleAnn = { status: 'published', targetType: 'middle' };
  const targetedMiddle = ann.resolveTargetedStudents(middleAnn, sampleStudents, sampleGrades, sampleClasses);
  assert.deepEqual(targetedMiddle.map(s => s.id), ['s2', 's4']);

  const highAnn = { status: 'published', targetType: 'high' };
  const targetedHigh = ann.resolveTargetedStudents(highAnn, sampleStudents, sampleGrades, sampleClasses);
  assert.deepEqual(targetedHigh.map(s => s.id), ['s3']);
});

test('4. تخصيص إعلان لطالب واحد فقط', () => {
  const oneAnn = { status: 'published', targetType: 'student', targetValue: 's3' };
  const targeted = ann.resolveTargetedStudents(oneAnn, sampleStudents, sampleGrades, sampleClasses);
  assert.deepEqual(targeted.map(s => s.id), ['s3']);
});

test('5 & 6. تسجيل المشاهدة الفردية وإحصائيات المدير', () => {
  assert.equal(typeof db.recordSchoolAnnouncementView, 'function');
  assert.equal(typeof db.listSchoolAnnouncementViews, 'function');
  assert.equal(typeof db.listStudentAnnouncementViewIds, 'function');

  assert.match(serverSrc, /app\.post\('\/api\/announcements\/:school\/:id\/view'/);
  assert.match(serverSrc, /app\.get\('\/api\/announcements\/:school\/:id\/views'/);
  assert.match(serverSrc, /if \(req\.session\.role !== 'STUDENT'\) return res\.status\(403\)/);
  assert.match(serverSrc, /if \(req\.session\.role !== 'ADMIN'\) return res\.status\(403\)/);
  assert.match(indexSrc, /openSchoolAnnouncementViewsModal/);
  assert.match(indexSrc, /__annViewsData\.tab='not_viewed'/);
});

test('7. انتهاء الإعلان واختفاؤه تلقائياً وعدم ظهور المسودات أو المتوقف مؤقتاً', () => {
  const expired = { status: 'published', startDate: '2026-11-01', endDate: '2026-11-21' };
  assert.equal(ann.isAnnouncementActiveOnDate(expired, '2026-11-22'), false);
  assert.equal(ann.isAnnouncementExpired(expired, '2026-11-22'), true);

  const future = { status: 'published', startDate: '2026-11-25', endDate: '2026-11-30' };
  assert.equal(ann.isAnnouncementActiveOnDate(future, '2026-11-22'), false);

  const draft = { status: 'draft', startDate: '2026-11-01', endDate: '2026-12-30' };
  assert.equal(ann.isAnnouncementActiveOnDate(draft, '2026-11-22'), false);

  const paused = { status: 'paused', startDate: '2026-11-01', endDate: '2026-12-30' };
  assert.equal(ann.isAnnouncementActiveOnDate(paused, '2026-11-22'), false);
});

test('8. تعديل الإعلان وحذفه وتثبيته بصلاحيات المدير فقط', () => {
  assert.equal(typeof db.createSchoolAnnouncement, 'function');
  assert.equal(typeof db.updateSchoolAnnouncement, 'function');
  assert.equal(typeof db.deleteSchoolAnnouncement, 'function');
  assert.match(serverSrc, /app\.post\('\/api\/announcements\/:school'/);
  assert.match(serverSrc, /app\.put\('\/api\/announcements\/:school\/:id'/);
  assert.match(serverSrc, /app\.delete\('\/api\/announcements\/:school\/:id'/);

  const sorted = ann.sortAnnouncements([
    { id: '1', pinned: false, createdAt: '2026-11-22T10:00:00Z' },
    { id: '2', pinned: true, createdAt: '2026-11-20T10:00:00Z' },
    { id: '3', pinned: false, createdAt: '2026-11-23T10:00:00Z' },
  ]);
  assert.deepEqual(sorted.map(x => x.id), ['2', '3', '1']);
});

test('9. استقلال إعلانات البنين عن البنات والهوية البصرية', () => {
  assert.match(serverSrc, /if \(reqSchool !== school \|\| !schoolAccess\(req\.session, school\)\)/);
  assert.match(serverSrc, /app\.get\('\/api\/announcements\/:school\/:id'/);

  if (db.SCHOOLS[0] === 'GIRLS') {
    assert.match(indexSrc, /\.ann-btn-primary \{ background:#db2777/);
  } else {
    assert.match(indexSrc, /\.ann-btn-primary \{ background:#2563eb/);
  }
});

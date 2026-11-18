const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const notesPrivacy = require('../notes-privacy');
const transferPrivacy = require('../transfers-privacy');

describe('Phase 1 & Phase 2 Tests: Notes and Transfers Reliability', () => {

  test('1. إصلاح تكرار batchId في loadDB: ملاحظات عدة طلاب في دفعة واحدة لا تُحذف', () => {
    // محاكاة دالة تنظيف loadDB في index.html
    function dedupeNotes(notes) {
      if (!Array.isArray(notes) || notes.length <= 1) return notes;
      const seenNoteKeys = new Set();
      const uniqNotes = [];
      let dupNote = false;
      notes.forEach(n => {
        if (!n) return;
        const kid = (n.id != null) ? ('id:' + String(n.id)) : null;
        const kbatch = (n.batchId != null) ? ('batch:' + String(n.batchId) + (n.studentId != null ? ('|' + String(n.studentId)) : '')) : null;
        if (!kid && !kbatch) { uniqNotes.push(n); return; }
        if ((kid && seenNoteKeys.has(kid)) || (kbatch && seenNoteKeys.has(kbatch))) { dupNote = true; return; }
        if (kid) seenNoteKeys.add(kid);
        if (kbatch) seenNoteKeys.add(kbatch);
        uniqNotes.push(n);
      });
      return uniqNotes;
    }

    const batchId = 'batch_12345';
    const notesBatch = [
      { id: 'n1', studentId: 'student_1', batchId, category: 'مشاركة متميزة', points: 5 },
      { id: 'n2', studentId: 'student_2', batchId, category: 'مشاركة متميزة', points: 5 },
      { id: 'n3', studentId: 'student_3', batchId, category: 'مشاركة متميزة', points: 5 },
    ];

    const result = dedupeNotes(notesBatch);
    assert.equal(result.length, 3, 'يجب أن تبقى جميع ملاحظات الطلاب الثلاثة في نفس الدفعة');
    assert.deepEqual(result.map(x => x.studentId), ['student_1', 'student_2', 'student_3']);

    // اختبار التكرار الحقيقي (نفس الطالب مرتين في نفس الدفعة بسبب نقر مزدوج)
    const withDuplicate = [
      ...notesBatch,
      { id: 'n4_dup', studentId: 'student_1', batchId, category: 'مشاركة متميزة', points: 5 }
    ];
    const cleanResult = dedupeNotes(withDuplicate);
    assert.equal(cleanResult.length, 3, 'يجب حذف السجل المكرر لنفس الطالب في نفس الدفعة');
    assert.deepEqual(cleanResult.map(x => x.id), ['n1', 'n2', 'n3']);
  });

  test('2. تعديل ملاحظة وفق صلاحيات مالكها (Owner Permissions)', () => {
    // التحقق على مستوى الخادم
    const serverNotes = [
      { id: 'note_101', studentId: 's1', category: 'احترام', description: 'سلوك طيب', createdBy: 'teacher_1' }
    ];
    const incomingUpdate = [
      { id: 'note_101', studentId: 's1', category: 'احترام متقدم', description: 'سلوك ممتاز وتعديل وصف', createdBy: 'teacher_1' }
    ];

    const session = { user_id: 'teacher_1', role: 'TEACHER' };
    const processed = notesPrivacy.enforceNoteOwners(incomingUpdate, session, serverNotes);

    assert.equal(processed.length, 1);
    assert.equal(processed[0].category, 'احترام متقدم', 'يجب اعتماد تعديل الفئة من قبل المالك');
    assert.equal(processed[0].description, 'سلوك ممتاز وتعديل وصف', 'يجب اعتماد تعديل الوصف من قبل المالك');
    assert.equal(processed[0].createdBy, 'teacher_1');
  });

  test('3. منع تعديل أو حذف ملاحظة معلم آخر (Colleague Protection)', () => {
    const serverNotes = [
      { id: 'note_101', studentId: 's1', category: 'ملاحظة المعلم الأول', description: 'أصلية', createdBy: 'teacher_1' }
    ];
    // محاولة معلم آخر (teacher_2) تعديل نص الملاحظة
    const maliciousEdit = [
      { id: 'note_101', studentId: 's1', category: 'تعديل غير مصرح به', description: 'مخترق', createdBy: 'teacher_2' }
    ];

    const sessionTeacher2 = { user_id: 'teacher_2', role: 'TEACHER' };
    const resultNotes = notesPrivacy.enforceNoteOwners(maliciousEdit, sessionTeacher2, serverNotes);

    assert.equal(resultNotes.length, 1);
    assert.equal(resultNotes[0].category, 'ملاحظة المعلم الأول', 'يجب رفض التعديل وإبقاء نسخة الخادم الأصلية');
    assert.equal(resultNotes[0].description, 'أصلية');
    assert.equal(resultNotes[0].createdBy, 'teacher_1');

    // محاولة حذف ملاحظة المعلم الأول بواسطة المعلم الثاني
    const maliciousDelete = [
      { id: 'note_101', deleted: true, deletedBy: 'teacher_2' }
    ];
    const delResult = notesPrivacy.enforceNoteDeleteRights(maliciousDelete, sessionTeacher2, serverNotes);
    assert.equal(delResult.blocked.length, 1, 'يجب حظر محاولة الحذف');
    assert.equal(delResult.notes[0].deleted, undefined, 'يجب إزالة علامة deleted');
  });

  test('4. إضافة تحويل واشتقاق createdBy من الجلسة وبقاؤه بعد محاكاة F5', () => {
    const incomingTransfers = [
      { id: 'tr_1', studentIds: ['s1'], target: 'COUNSELOR', reason: 'سلوك', status: 'PENDING' }
    ];
    const sessionTeacher = { user_id: 'teacher_abc', role: 'TEACHER' };

    // الخادم يفرض createdBy من session.user_id
    const enforced = transferPrivacy.enforceTransferOwners(incomingTransfers, sessionTeacher, []);
    assert.equal(enforced.length, 1);
    assert.equal(enforced[0].createdBy, 'teacher_abc', 'يجب اشتقاق createdBy من جلسة المعلم الموثوقة');

    // محاكاة استرجاع البيانات بعد F5 (GET /api/db/BOYS)
    const viewerMe = { user_id: 'teacher_abc', role: 'TEACHER' };
    const viewerOther = { user_id: 'teacher_xyz', role: 'TEACHER' };
    const viewerAdmin = { user_id: 'admin_1', role: 'ADMIN' };

    const forMe = transferPrivacy.filterTransfersForViewer(enforced, viewerMe);
    assert.equal(forMe.length, 1, 'المعلم المنشئ يجب أن يرى تحويله بعد F5');
    assert.equal(forMe[0].id, 'tr_1');

    const forOther = transferPrivacy.filterTransfersForViewer(enforced, viewerOther);
    assert.equal(forOther.length, 0, 'المعلم الآخر يجب ألا يرى تحويل زميله');

    const forAdmin = transferPrivacy.filterTransfersForViewer(enforced, viewerAdmin);
    assert.equal(forAdmin.length, 1, 'المدير يرى جميع التحويلات');
  });

  test('5. معالجة التحويلات القديمة بلا createdBy بأمان', () => {
    const legacyTransfers = [
      { id: 'tr_legacy_1', studentIds: ['s1'], reason: 'تحويل قديم', status: 'PENDING' }
    ];

    const teacherViewer = { user_id: 'teacher_1', role: 'TEACHER' };
    const counselorViewer = { user_id: 'counselor_1', role: 'COUNSELOR' };
    const adminViewer = { user_id: 'admin_1', role: 'ADMIN' };

    // التحويل القديم بلا createdBy لا يظهر للمعلم العادي
    const seenByTeacher = transferPrivacy.filterTransfersForViewer(legacyTransfers, teacherViewer);
    assert.equal(seenByTeacher.length, 0, 'المعلم العادي لا يرى تحويلات قديمة غير منسوبة له');

    // يظهر للأدوار الإشرافية
    const seenByCounselor = transferPrivacy.filterTransfersForViewer(legacyTransfers, counselorViewer);
    assert.equal(seenByCounselor.length, 1, 'الموجه الطلابي يرى التحويل القديم');

    const seenByAdmin = transferPrivacy.filterTransfersForViewer(legacyTransfers, adminViewer);
    assert.equal(seenByAdmin.length, 1, 'المدير يرى التحويل القديم');

    // محاولة معلم تعديل أو حذف التحويل القديم
    const attemptDelete = transferPrivacy.enforceTransferDeleteRights(
      [{ id: 'tr_legacy_1', deleted: true }],
      teacherViewer,
      legacyTransfers
    );
    assert.equal(attemptDelete.blocked.length, 1, 'المعلم لا يستطيع حذف تحويل قديم');
  });

  test('6. معالجة اختلاف نوع المعرف String و Number بأمان', () => {
    function safeDeletable(n, me) {
      if (!me || !n || n.deleted) return false;
      if (me.role === 'ADMIN') return true;
      const owner = n.createdBy != null ? String(n.createdBy).trim() : '';
      const myId = me.id != null ? String(me.id).trim() : '';
      return !!owner && !!myId && owner === myId;
    }

    // المعرف رقم في الملاحظة، ونص في كائن المستخدم
    assert.equal(safeDeletable({ createdBy: 42 }, { id: '42', role: 'TEACHER' }), true);
    // المعرف نص في الملاحظة، ورقم في كائن المستخدم
    assert.equal(safeDeletable({ createdBy: '42' }, { id: 42, role: 'TEACHER' }), true);
    // معرفان مختلفان
    assert.equal(safeDeletable({ createdBy: 42 }, { id: '99', role: 'TEACHER' }), false);

    // فحص إسناد الفصول
    function canSeeClass(classItem, user) {
      const uidStr = String(user.id != null ? user.id : '').trim();
      return (classItem.teacherIds || []).some(tid => String(tid != null ? tid : '').trim() === uidStr);
    }

    assert.equal(canSeeClass({ teacherIds: ['10', '20'] }, { id: 20 }), true);
    assert.equal(canSeeClass({ teacherIds: [10, 20] }, { id: '20' }), true);
    assert.equal(canSeeClass({ teacherIds: [10, 20] }, { id: 30 }), false);
  });

});

/* ============================================================================
 * ⭐ نجمة الأسبوع — واجهة العميل
 * ينفَّذ تلقائيًا عند تحميل الصفحة (لا حاجة لاستدعاء).
 * المبدأ: لا نحسب الصلاحيات هنا إطلاقًا. الخادم هو الذي يقرر من هي الرائدة ومن
 * يكتب النجمة؛ هذه الطبقة تعرض ما يصل منها فقط.
 * ==========================================================================*/
(function () {
  'use strict';
  if (window.__stwInstalled) return;
  window.__stwInstalled = true;

  const STARS_API = '/api/stars/';
  // شبكة المسح: دقة أعلى = كشف أدقّ. نصف القطر بوحدات الخلايا.
  const STW_COLS = 20, STW_ROWS = 12, STW_RADIUS = 1.6;
  const STW_THRESHOLD = 0.995;   // لوح البطاقة عند اكتمال المسح (تقريبًا)

  const state = window.__stw = { loading: false, loaded: false, view: null, traits: [], error: '' };

  const esc = (v) => (typeof escapeHtml === 'function')
    ? escapeHtml(v)
    : String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reducedMotion = () => (typeof matchMedia === 'function')
    && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── 1) منطق المسح النقي (قابل للاختبار بلا DOM) ─────────────────────────
  // يحوّل مسارات المؤشّر (نِسَب 0..1) إلى نسبة مسح 0..1: كل خلية تُلمس تُحسب،
  // والنسبة = المسح / المساحة كلها. لا hover ولا مؤقّت: يعمل باللمس والماوس.
  function coverage(points, cols, rows, radius) {
    cols = cols || STW_COLS; rows = rows || STW_ROWS; radius = (radius == null) ? STW_RADIUS : radius;
    if (!Array.isArray(points) || !points.length) return 0;
    const grid = new Uint8Array(cols * rows);
    const mark = (px, py) => {
      const c0 = Math.max(0, Math.floor(px - radius)), c1 = Math.min(cols - 1, Math.ceil(px + radius));
      const r0 = Math.max(0, Math.floor(py - radius)), r1 = Math.min(rows - 1, Math.ceil(py + radius));
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const dx = c + 0.5 - px, dy = r + 0.5 - py;
          if (dx * dx + dy * dy <= radius * radius) grid[r * cols + c] = 1;
        }
      }
    };
    const first = points[0];
    mark(first.x * cols, first.y * rows);
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      const ax = a.x * cols, ay = a.y * rows, bx = b.x * cols, by = b.y * rows;
      const dist = Math.hypot(bx - ax, by - ay);
      const steps = Math.max(1, Math.ceil(dist * 2));
      for (let k = 0; k <= steps; k++) mark(ax + (bx - ax) * k / steps, ay + (by - ay) * k / steps);
    }
    let hit = 0;
    for (let i = 0; i < grid.length; i++) if (grid[i]) hit++;
    return hit / grid.length;
  }
  const percentOf = (p) => Math.max(0, Math.min(100, Math.round(p * 100)));
  // 0 / 25 / 50 / 75 / 100  (0..4)
  const stepOf = (p) => Math.min(4, Math.floor(p * 4));

  // ── 2) بناء البطاقة من نفس كائن النجمة المحفوظ ─────────────────────────
  function cardHTML(star, weekLabel) {
    if (!star) return '';
    const traits = (star.traitsLabels && star.traitsLabels.length)
      ? star.traitsLabels
      : (star.traits || []);
    return '<div class="stw-card">'
      + '<div class="stw-head"><div class="stw-logo">⭐</div><div>'
      + '<p class="stw-title">نجمة الأسبوع</p>'
      + '<div class="stw-week">' + esc(weekLabel || star.weekKey || '') + '</div></div></div>'
      + '<div class="stw-name">' + esc(star.studentName || '') + '</div>'
      + '<div class="stw-cls">' + esc(star.className || '') + '</div>'
      + '<div class="stw-traits">'
      + traits.map(t => '<span class="stw-trait">' + esc(t) + '</span>').join('')
      + '</div>'
      + (star.message ? '<div class="stw-msg">“' + esc(star.message) + '”</div>' : '')
      + '</div>';
  }

  // ── 3) الاتصال بالخادم ─────────────────────────────────────────────────
  function api(path, body) {
    const opt = { method: body ? 'POST' : 'GET', headers: {}, credentials: 'same-origin' };
    if (body) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    return fetch(STARS_API + path, opt)
      .then(r => r.json().catch(() => ({})).then(j => ({ status: r.status, ok: r.ok, j })))
      .catch(() => ({ status: 0, ok: false, j: {} }));
  }
  function load() {
    if (state.loading) return Promise.resolve();
    state.loading = true;
    return api('').then(r => {
      state.loading = false;
      state.loaded = true;
      if (r.ok && r.j && r.j.ok) {
        state.view = r.j; state.traits = r.j.traits || []; state.error = ''; state.errorStatus = 0; state.errorReason = '';
      } else {
        state.error = (r.j && r.j.error) || 'load_failed';
        state.errorStatus = r.status || 0;
        state.errorReason = (r.j && r.j.reason) || '';
        console.warn('[star-week] تعذّر تحميل نجمة الأسبوع:', state.errorStatus, state.error, state.errorReason);
      }
      if (state.errorStatus === 401) return onUnauthorized();
      return paint();
    });
  }
  function retry() {
    state.error = ''; state.errorStatus = 0; state.errorReason = ''; state.probe = null; state.loaded = false;
    return load();
  }
  // هل الجلسة نفسها حيّة على الخادم؟ /(api/auth/me) هو نفس requireAuth.
  // فائدته: يفصل بين حالتين متشابهة ظاهريًا — (أ) الجلسة منتهية فعلًا، فيجب الدخول،
  // و(ب) الجلسة سليمة لكن مسار النجمة وحده يرفض الطلب، وهو عطل خادم يحتاج إصلاحًا.
  function probeSession() {
    try {
      if (typeof __api === 'function')
        return __api('GET', 'me').then(r => ({ alive: r.status === 200, status: r.status }));
    } catch (e) { /* نكمل بمسار بديل */ }
    return fetch('/api/auth/me')
      .then(r => ({ alive: r.status === 200, status: r.status }))
      .catch(() => ({ alive: false, status: 0 }));
  }
  function onUnauthorized() {
    return probeSession().then(p => {
      state.probe = p;
      // جلسة ميتة فعلًا ⇒ لا نُبقي التطبيق يتظاهر بأنه مسجّل الدخول.
      if (!p.alive && typeof __handleAuthError === 'function') {
        try { __handleAuthError({ status: 401 }); } catch (e) { /* لا شيء */ }
      }
      return paint();
    });
  }
  function errorHTML() {
    const code = state.error || 'load_failed';
    const st = state.errorStatus || 0;
    const why = { no_cookie: 'لا يوجد كوكي جلسة في المتصفح',
                  no_session_row: 'الجلسة غير موجودة أو منتهية على الخادم' }[state.errorReason] || '';
    if (st === 401 || code === 'unauthorized') {
      // sessions حيّة + مسار النجمة يرفض ⇒ ليست مشكلة جلسة، فنتصرّف ونطلب الإصلاح.
      if (state.probe && state.probe.alive)
        return '<div>جلستك سليمة على الخادم، لكن طلب النجمة رُفض — هذه مشكلة في الخادم لا في حسابك.</div>'
          + '<div class="stw-actions"><button class="stw-btn ghost" onclick="__stwRetry()">إعادة المحاولة</button></div>'
          + '<div class="stw-hint-sm">سبب الرفض من الخادم: ' + esc(why || code) + '</div>';
      return '<div>انتهت جلستك على الخادم — هذا الميزة تقرأ من الخادم مباشرة، ' +
        'فلا تظهر ببيانات الجهاز القديمة. سجّلي الدخول من جديد وستعود النجمة.</div>'
        + '<div class="stw-actions"><button class="stw-btn" onclick="location.hash=\'#/login\';' +
        ' if(typeof renderApp===\'function\') renderApp();">تسجيل الدخول</button>'
        + '<button class="stw-btn ghost" onclick="__stwRetry()">إعادة المحاولة</button></div>'
        + (why ? '<div class="stw-hint-sm">' + esc(why) + '</div>' : '');
    }
    return '<div>تعذّر تحميل نجمة الأسبوع.</div>'
      + '<div class="stw-actions"><button class="stw-btn ghost" onclick="__stwRetry()">إعادة المحاولة</button></div>'
      + '<div class="stw-hint-sm" dir="ltr" style="text-align:left">http=' + esc(String(st)) + ' · error=' + esc(code) + '</div>';
  }

  // ── 4) المموحاة: مؤشّر واحد يخدم الماوس واللمس والقلم ───────────────────
  function initEraser(root) {
    if (!root || root.__stwReady) return;
    const cv = root.querySelector('canvas');
    if (!cv) return;
    const star = (state.view && state.view.stars || [])[Number(root.getAttribute('data-idx') || 0)];
    if (!star) return;
    root.__stwReady = true;
    const pctEl = root.querySelector('[data-stw-pct]');
    const hint = root.querySelector('.stw-eraser-hint');
    const reduce = reducedMotion();
    // نُسخة ممحاة لكل (أسبوع + فصل + طالبة): البطاقة تبقى مكشوفة بعد إعادة التحميل
    const key = 'stw_seen_' + (star.weekKey || '') + '_' + (star.classId || '') + '_' + (star.studentId || '');
    let revealed = false, pts = [], raf = 0;
    let storedRevealed = false;
    try { storedRevealed = localStorage.getItem(key) === '1'; } catch (e) {}

    const size = () => {
      const r = root.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.max(1, Math.round(r.width * dpr));
      cv.height = Math.max(1, Math.round(r.height * dpr));
      const c = cv.getContext('2d');
      if (c) c.setTransform(dpr, 0, 0, dpr, 0, 0);
      return r;
    };
    const ctx = () => cv.getContext('2d');

    function sheet() {
      const r = root.getBoundingClientRect();
      const c = ctx(); if (!c) return;
      c.clearRect(0, 0, r.width, r.height);
      // غطاء بلون الهوية الوردي (نفس --primary) حتى لا ينافس لون بقية اللوحات
      c.fillStyle = (getComputedStyle(document.body).getPropertyValue('--primary') || '').trim() || '#be185d';
      c.fillRect(0, 0, r.width, r.height);
      c.fillStyle = 'rgba(255,255,255,.94)';
      c.font = '700 14px system-ui, "Segoe UI", sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('🪄  «امسحي» لتكتشفي نجمة الأسبوع', r.width / 2, r.height / 2);
    }
    function paintStroke() {
      const r = root.getBoundingClientRect();
      const c = ctx(); if (!c) return;
      c.save();
      c.globalCompositeOperation = 'destination-out';
      c.lineCap = 'round'; c.lineJoin = 'round';
      c.lineWidth = STW_RADIUS * 2 * (r.width / STW_COLS);
      c.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        if (i === 0) c.moveTo(p.x * r.width, p.y * r.height);
        else {
          const q = pts[i - 1];
          c.moveTo(q.x * r.width, q.y * r.height);
          c.lineTo(p.x * r.width, p.y * r.height);
        }
      }
      c.stroke();
      c.restore();
    }
    function applyReveal(immediate) {
      revealed = true;
      if (pctEl) pctEl.style.display = 'none';
      if (hint) hint.style.display = 'none';
      try { localStorage.setItem(key, '1'); } catch (e) {}
      if (immediate || reduce) { if (cv.parentNode) cv.parentNode.removeChild(cv); return; }
      cv.style.transition = 'opacity .35s ease';
      cv.style.opacity = '0';
      setTimeout(() => { if (cv.parentNode) cv.parentNode.removeChild(cv); }, 360);
    }
    function finish() {
      if (revealed) return;
      applyReveal(false);
    }
    function progress() {
      const p = coverage(pts, STW_COLS, STW_ROWS, STW_RADIUS);
      if (pctEl) pctEl.textContent = percentOf(p) + '%';
      if (p >= STW_THRESHOLD) finish();
      raf = 0;
    }
    const schedule = () => { if (!raf) raf = requestAnimationFrame(progress); };
    function pos(e) {
      const r = root.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      return {
        x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
        y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))
      };
    }
    function down(e) {
      if (revealed) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();                       // يمنع سحب الصورة/تحديد النص فقط داخل المموحاة
      const p = pos(e); if (!p) return;
      pts = [p];
      try { root.setPointerCapture(e.pointerId); } catch (err) {}
      paintStroke(); schedule();
    }
    function move(e) {
      if (revealed || !pts.length) return;
      if (e.pointerType === 'mouse' && e.buttons === 0) return;
      e.preventDefault();
      const p = pos(e); if (!p) return;
      pts.push(p);
      paintStroke(); schedule();
    }
    function up(e) {
      if (revealed || !pts.length) return;
      try { root.releasePointerCapture(e.pointerId); } catch (err) {}
      if (coverage(pts, STW_COLS, STW_ROWS, STW_RADIUS) >= STW_THRESHOLD) finish();
    }
    root.addEventListener('pointerdown', down);
    root.addEventListener('pointermove', move);
    root.addEventListener('pointerup', up);
    root.addEventListener('pointercancel', up);
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('resize', () => { size(); if (!revealed) sheet(); });
    }
    size();
    if (storedRevealed) applyReveal(true); else sheet();
  }

  // ── 5) العرض ──────────────────────────────────────────────────────────
  function getClassName(classId) {
    if (state.view && state.view.me && Array.isArray(state.view.me.ownedClasses)) {
      const found = state.view.me.ownedClasses.find(c => c && c.id === classId);
      if (found && found.name) return found.name;
    }
    if (state.view && Array.isArray(state.view.owners)) {
      const found = state.view.owners.find(o => o && o.classId === classId);
      if (found && found.className) return found.className;
    }
    const serverClass = ((state.view && state.view.classes) || []).find(x => x && x.id === classId);
    if (serverClass) return serverClass.name || classId;
    return classId || '';
  }

  function adminHTML(v) {
    const current = (v.stars || [])[0];
    let html = '<div class="stw-wrap"><div class="stw-card">'
      + '<div class="stw-head"><div class="stw-logo">⚙️</div><div>'
      + '<p class="stw-title">إدارة نجمة الأسبوع</p></div></div>'
      + (current ? '<div class="stw-note">النجمة الحالية: ' + esc(current.studentName) + ' · '
        + esc(current.className) + '</div>' : '<div class="stw-note">لم تُسجَّل نجمة لهذا الأسبوع بعد.</div>')
      + '<button class="stw-btn" onclick="__stwOpenPick()">' + (current ? 'تعديل / تغيير النجمة' : 'اختيار نجمة الأسبوع') + '</button>';
    if (v.history && v.history.length) {
      html += '<div class="stw-week" style="margin-top:12px;font-weight:800">سجل الأسابيع</div>'
        + '<div class="stw-scroll"><table class="stw-table"><thead><tr><th>الأسبوع</th><th>الفصل</th>'
        + '<th>النجمة</th><th>الصفات</th></tr></thead><tbody>';
      v.history.forEach(h => {
        html += '<tr><td>' + esc(h.weekKey) + '</td><td>' + esc(h.className)
          + '</td><td>' + esc(h.studentName) + '</td><td>' + esc((h.traitsLabels || []).join(' · ')) + '</td></tr>';
      });
      html += '</tbody></table></div>';
    }
    html += '<div data-stw-pick></div>';
    return html + '</div></div>';
  }

  function sectionHTML() {
    const v = state.view;
    if (!v) return '<div data-stw-mount class="stw-wrap"><div class="stw-card stw-hint-sm">جارِ تحميل «نجمة الأسبوع»…</div></div>';
    if (state.error)
      return '<div data-stw-mount class="stw-wrap"><div class="stw-card">' + errorHTML() + '</div></div>';
    const stars = v.stars || [];
    let html = '';
    if (!stars.length) {
      html += '<div class="stw-wrap"><div class="stw-card">'
        + '<div class="stw-head"><div class="stw-logo">⭐</div><div>'
        + '<p class="stw-title">نجمة الأسبوع</p>'
        + '<div class="stw-week">' + esc(v.week ? (v.week.label || v.week.key) : '') + '</div></div></div>'
        + '<div class="stw-note">لم تُسجَّل نجمة لهذا الأسبوع بعد.</div></div></div>';
    } else {
      stars.forEach((star, i) => {
        html += '<div class="stw-wrap" style="margin-top:0;margin-bottom:12px">'
          + '<div class="stw-eraser" data-stw-eraser data-idx="' + i + '">'
          + cardHTML(star, v.week ? (v.week.label || v.week.key) : '')
          + '<canvas aria-hidden="true"></canvas>'
          + '<div class="stw-pct" data-stw-pct>0%</div>'
          + '<div class="stw-eraser-hint"><div><div style="font-size:30px">🪄</div>'
          + '<b>امسحي لتكتشفي نجمة الأسبوع</b>'
          + '<span>اسحبي بالمؤشّر أو بإصبعك على الشاشة</span></div></div>'
          + '</div></div>';
      });
    }
    // لا اختيار للمعلمات: الإدارة وحدها (تهاني) تُدخل النجمة لكل الفصول.
    if (v.me && v.me.isManager) html += adminHTML(v);
    return html;
  }

  function paint() {
    const nodes = document.querySelectorAll('[data-stw-mount]');
    for (let i = 0; i < nodes.length; i++) nodes[i].innerHTML = sectionHTML();
    const eras = document.querySelectorAll('[data-stw-eraser]');
    for (let i = 0; i < eras.length; i++) initEraser(eras[i]);
    // مؤقّتات التطبيق (المزامنة/الإشعارات) تعيد رسم اللوحة، فالنافذة المفتوحة
    // تُعاد رسمها من state حتى لا يضيع ما اختيرته الإدارة.
    if (state.pick && state.pick.classId) renderPicker();
  }

  // ── 6) نافذة اختيار نجمة المدرسة (للـ ADMIN فقط) ─────────────────────
  // الحالة في state لا داخل الإغلاق: إعادة رسم اللوحة تستبدل عناصر النافذة،
  // فلو عاش الاختيار داخل الإغلاق لضاع بمجرد مزامنة واحدة، وتبدو القائمة
  // «تفتح ولا تُختار».
  function pick() {
    if (!state.pick) state.pick = { classId: '', studentId: '', message: '', traits: {}, inited: false };
    return state.pick;
  }
  function closePick() {
    state.pick = null;
    const hosts = document.querySelectorAll('[data-stw-pick]');
    for (let i = 0; i < hosts.length; i++) hosts[i].innerHTML = '';
  }
  function pickHost() { return document.querySelector('[data-stw-pick]'); }
  function nameOf(list, id) {
    const s = (list || []).filter(x => x && x.id === id)[0];
    return s ? (s.fullName || s.id) : '';
  }
  function rowHTML(id, label, on) {
    return '<div class="stw-row' + (on ? ' on' : '') + '" data-stw-sid="' + esc(id) + '"'
      + ' data-stw-name="' + esc(label) + '">' + (on ? '✔ ' : '') + esc(label) + '</div>';
  }

  function openPick(targetClassId) {
    const v = state.view; if (!v) return;
    const current = (v.stars || [])[0];
    const cid = targetClassId || (current && current.classId) || ((v.classes || [])[0] || {}).id || '';
    const p = pick();
    const changed = !!cid && cid !== p.classId;
    p.classId = cid;
    // تهيئة واحدة لكل فصل: تفتح على المحفوظ فعلًا، وتُصفَّر عند تغيير الفصل.
    if (!p.inited || changed) {
      const cur = (v.stars || []).filter(x => x.classId === cid)[0];
      p.studentId = (cur && cur.studentId) || '';
      p.message = (cur && cur.message) || '';
      p.traits = {};
      (cur ? (cur.traits || []) : []).forEach(t => { p.traits[t] = 1; });
      p.inited = true;
    }
    renderPicker();
    const host = pickHost(cid);
    if (host && host.scrollIntoView) host.scrollIntoView({ block: 'nearest' });
  }

  function renderPicker() {
    const v = state.view; const p = state.pick;
    if (!v || !p || !p.classId) return;
    const host = pickHost(p.classId);
    if (!host) return;
    const className = getClassName(p.classId);
    const list = (v.students || []).filter(s => s && s.classId === p.classId);
    host.innerHTML = '<div class="stw-week" style="margin-top:12px;font-weight:800">اختيار نجمة الأسبوع</div>'
      + '<label>الفصل <select class="input" data-stw-class style="width:100%">'
      + (v.classes || []).map(c => '<option value="' + esc(c.id) + '"' + (c.id === p.classId ? ' selected' : '')
        + '>' + esc(c.name) + '</option>').join('')
      + '</select></label><div class="stw-hint-sm">' + esc(className) + '</div>'
      + '<div class="stw-note">اضغطي على اسم الطالبة، ثم صفة واحدة على الأقل، ثم احفظي. المختارة الآن: '
      + '<span data-stw-picked>' + esc(nameOf(list, p.studentId) || 'لا أحد') + '</span></div>'
      + '<div class="stw-list" style="margin-top:6px">'
      + (list.length
        ? list.map(s => rowHTML(s.id, s.fullName || s.id, s.id === p.studentId)).join('')
        : '<div class="stw-hint-sm" style="padding:10px">لا توجد طالبات في هذا الفصل.</div>')
      + '</div>'
      + '<div class="stw-chips">'
      + (state.traits || []).map(t => '<button type="button" class="stw-chip' + (p.traits[t.id] ? ' on' : '')
        + '" data-stw-tid="' + esc(t.id) + '">' + esc(t.emoji + ' ' + t.label) + '</button>').join('')
      + '</div>'
      + '<input class="input" data-stw-msg maxlength="140" placeholder="عبارة قصيرة عن سبب الاختيار (اختياري)" style="width:100%">'
      + '<div class="stw-actions">'
      + '<button class="stw-btn" onclick="__stwSavePick()">حفظ النجمة</button>'
      + '<button class="stw-btn ghost" onclick="__stwClosePick()">إلغاء</button>'
      + '</div>';
    const mi = host.querySelector('[data-stw-msg]');
    if (mi) { mi.value = p.message || ''; mi.oninput = () => { p.message = mi.value; }; }
    bindPickEvents();
  }

  // تفويض الأحداث على document مرة واحدة: يبقى فعّالًا مهما أُعيد رسم اللوحة،
  // بخلاف ربط onclick لكل عنصر (يُفقد مع أول re-render).
  function bindPickEvents() {
    if (bindPickEvents.__bound) return;
    bindPickEvents.__bound = true;
    document.addEventListener('click', (e) => {
      const t = e.target;
      if (!t || !t.closest) return;
      const row = t.closest('[data-stw-sid]');
      if (row) {
        const p = pick();
        p.studentId = row.getAttribute('data-stw-sid');
        const host = pickHost(p.classId);
        if (host) host.querySelectorAll('[data-stw-sid]').forEach(x => {
          const on = (x === row);
          const label = x.getAttribute('data-stw-name') || '';
          x.classList.toggle('on', on);
          x.textContent = (on ? '✔ ' : '') + label;
        });
        const out = document.querySelector('[data-stw-picked]');
        if (out) out.textContent = nameOf((state.view && state.view.students) || [], p.studentId) || p.studentId;
        return;
      }
      const chip = t.closest('[data-stw-tid]');
      if (chip) {
        const p = pick();
        const id = chip.getAttribute('data-stw-tid');
        if (p.traits[id]) delete p.traits[id]; else p.traits[id] = 1;
        chip.classList.toggle('on');
      }
    }, false);
    document.addEventListener('change', (e) => {
      const t = e.target;
      if (!t || !t.matches || !t.matches('[data-stw-class]')) return;
      const p = pick();
      p.classId = t.value;
      p.studentId = '';
      const host = pickHost(p.classId);
      if (host) renderPicker();
    }, false);
  }

  function savePick() {
    const p = state.pick;
    if (!p || !p.classId) { alert('اختاري الفصل أولًا من جدول الإدارة.'); return; }
    if (!p.studentId) { alert('اختاري الطالبة أولًا'); return; }
    if (!Object.keys(p.traits).length) { alert('اختاري صفة واحدة على الأقل'); return; }
    const g = {
      classId: p.classId, studentId: p.studentId,
      message: p.message || '', traits: Object.keys(p.traits)
    };
    api('award', g).then(r => {
      if (r.ok && r.j && r.j.ok) {
        state.view = r.j; state.traits = r.j.traits || []; state.pick = null;
        return paint();
      }
      const code = (r.j && r.j.error) || 'save_failed';
      if (r.status === 401 || code === 'unauthorized') {
        // 401 عند الحفظ: نفس التشخيص (جلسة ميتة أم عطل في مسار النجمة؟).
        state.error = 'unauthorized'; state.errorStatus = 401;
        state.errorReason = (r.j && r.j.reason) || '';
        return onUnauthorized();
      }
      if (code === 'not_owner') alert('لست الجهة المخوّلة لهذا الفصل.');
      else if (code === 'student_not_in_class') alert('الطالبة لا تنتمي إلى هذا الفصل.');
      else if (code === 'bad_traits') alert('اختاري صفة على الأقل.');
      else alert('تعذّر حفظ النجمة: ' + code);
    });
  }

  // ── 7) الربط: أي re-render في التطبيق يحدّث البطاقات ───────────────────
  window.__stwOpenPick = openPick;
  window.__stwRetry = retry;
  window.__stwErrorHTML = errorHTML;
  window.__stwProbeSession = probeSession;
  window.__stwSavePick = savePick;
  window.__stwClosePick = closePick;
  window.__stwRenderPicker = renderPicker;
  window.__stwInitEraser = initEraser;
  // منطق نقي مُعرَّض للاختبارات (لا DOM)
  window.__stwCoverage = coverage;
  window.__stwPercentOf = percentOf;
  window.__stwStepOf = stepOf;
  window.__stwCardHTML = cardHTML;
  window.__stwSectionHTML = sectionHTML;
  window.__stwState = state;
  window.__stwPaint = paint;
  window.__stwLoad = load;
  window.__stwThreshold = STW_THRESHOLD;

  // ── 7) الربط: أي re-render في التطبيق يحدّث البطاقات ───────────────────
  // التوقيت مهم: هذا الملف يُحمَّل بعد السكربت الرئيسي الذي ينادي renderApp()
  // في نهايته، أي أن أول رسم قد سبق تركيبنا. لذلك نلتقط ذلك الـDOM فورًا
  // بدل انتظار renderApp آخر.
  const origRender = window.renderApp;
  if (typeof origRender === 'function' && !origRender.__stwWrapped) {
    const wrapped = function () {
      const out = origRender.apply(this, arguments);
      try { afterRender(); } catch (e) {}
      return out;
    };
    wrapped.__stwWrapped = true;
    window.renderApp = wrapped;
  }
  function afterRender(){
    if (!document.querySelector('[data-stw-mount]')) return;   // لا نقطة تركيب (صفحة أخرى)
    if (state.loading) return;
    if (state.loaded) paint(); else load();
  }
  // تشغيل فوري إن كانت نقطة التركيب موجودة أصلًا في DOM المرسوم مسبقًا
  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', afterRender, { once: true });
  } else {
    try { afterRender(); } catch (e) {}
  }
})();

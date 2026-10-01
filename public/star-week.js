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
    const opt = { method: body ? 'POST' : 'GET', headers: {} };
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
      if (r.ok && r.j && r.j.ok) { state.view = r.j; state.traits = r.j.traits || []; state.error = ''; }
      else state.error = (r.j && r.j.error) || 'load_failed';
      return paint();
    });
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
    const d = (typeof loadDB === 'function') ? loadDB() : {};
    const c = (d.classes || []).find(x => x && x.id === classId);
    if (!c) return classId || '';
    const g = (d.grades || []).find(x => x && x.id === c.gradeId);
    return (g ? g.name + ' — ' : '') + (c.name || classId);
  }

  function pickerHTML(owned) {
    return owned.map(classId => {
      const clsName = getClassName(classId);
      const cur = (state.view.stars || []).find(x => x.classId === classId);
      const titleSuffix = clsName ? ' — ' + esc(clsName) : '';
      return '<div class="stw-wrap"><div class="stw-card">'
        + '<div class="stw-head"><div class="stw-logo">🏷️</div><div>'
        + '<p class="stw-title">اختيار نجمة الأسبوع' + titleSuffix + '</p>'
        + '<div class="stw-week">أنت رائدة الفصل · الخيار يحدّده النظام</div></div></div>'
        + '<div class="stw-note">' + (cur ? 'مختارة حاليًا: ' + esc(cur.studentName) : 'لم تُختَر بعدًا') + '</div>'
        + '<div class="stw-actions"><button class="stw-btn" onclick="__stwOpenPick(\'' + esc(classId) + '\')">'
        + (cur ? 'تعديل الاختيار' : 'اختيار النجمة') + '</button></div>'
        + '<div data-stw-pick data-stw-class="' + esc(classId) + '"></div></div></div>';
    }).join('');
  }

  function adminHTML(v) {
    let html = '<div class="stw-wrap"><div class="stw-card">'
      + '<div class="stw-head"><div class="stw-logo">📊</div><div>'
      + '<p class="stw-title">رائدة الفصل — للإدارة</p></div></div>';
    if (v.owners && v.owners.length) {
      html += '<div class="stw-scroll"><table class="stw-table"><thead><tr><th>الفصل</th><th>الرائدة</th>'
        + '<th>الحصص</th><th>نجمة الأسبوع</th></tr></thead><tbody>';
      v.owners.forEach(o => {
        const st = (v.stars || []).filter(x => x.classId === o.classId)[0];
        html += '<tr><td>' + esc(o.className) + '</td><td>' + esc(o.ownerName || '—')
          + (o.tie ? ' <span class="stw-hint-sm">(تعادل)</span>' : '')
          + (o.source === 'assigned' ? ' <span class="stw-hint-sm">(معلمة الفصل المسندة)</span>' : '')
          + '</td><td>' + esc(String(o.periods)) + '</td><td>'
          + (st ? esc(st.studentName) + '<div class="stw-hint-sm">' + esc((st.traitsLabels || []).join(' · ')) + '</div>' : '—')
          + '</td></tr>';
      });
      html += '</tbody></table></div>';
    }
    if (v.history && v.history.length) {
      html += '<div class="stw-week" style="margin-top:12px;font-weight:800">سجل الأسابيع</div>'
        + '<div class="stw-scroll"><table class="stw-table"><thead><tr><th>الأسبوع</th><th>الفصل</th>'
        + '<th>المعلمة</th><th>النجمة</th><th>الصفات</th></tr></thead><tbody>';
      v.history.forEach(h => {
        html += '<tr><td>' + esc(h.weekKey) + '</td><td>' + esc(h.className) + '</td><td>' + esc(h.teacherName)
          + '</td><td>' + esc(h.studentName) + '</td><td>' + esc((h.traitsLabels || []).join(' · ')) + '</td></tr>';
      });
      html += '</tbody></table></div>';
    }
    return html + '</div></div>';
  }

  function sectionHTML() {
    const v = state.view;
    if (!v) return '<div data-stw-mount class="stw-wrap"><div class="stw-card stw-hint-sm">جارِ تحميل «نجمة الأسبوع»…</div></div>';
    if (state.error)
      return '<div data-stw-mount class="stw-wrap"><div class="stw-card stw-hint-sm">تعذّر عرض نجمة الأسبوع الآن.</div></div>';
    const stars = v.stars || [];
    const owned = (v.me && v.me.ownedClassIds) || [];
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
    if (owned.length) html += pickerHTML(owned);
    else if (v.me && v.me.role === 'TEACHER' && !v.me.isManager)
      // لا نُخفي السبب: غياب الأداة مخوّل للنظام لا خطأ عارض.
      html += '<div class="stw-wrap"><div class="stw-card">'
        + '<div class="stw-head"><div class="stw-logo">🏷️</div><div>'
        + '<p class="stw-title">رائدة الفصل</p>'
        + '<div class="stw-week">تُحدَّد آليًا حسب الحصص</div></div></div>'
        + '<div class="stw-note">لم تظهر لك أداة الاختيار لأنك لست رائدة فصل حاليًا. '
        + 'رائدة الفصل هي الأكثر تدريسًا له، وتُحدَّد من جدول الحصص. '
        + 'راجعي الإدارة إن كان ذلك غير صحيح.</div></div></div>';
    if (v.me && v.me.isManager && ((v.owners && v.owners.length) || (v.history && v.history.length)))
      html += adminHTML(v);
    return html;
  }

  function paint() {
    const nodes = document.querySelectorAll('[data-stw-mount]');
    for (let i = 0; i < nodes.length; i++) nodes[i].innerHTML = sectionHTML();
    const eras = document.querySelectorAll('[data-stw-eraser]');
    for (let i = 0; i < eras.length; i++) initEraser(eras[i]);
  }

  // ── 6) نافذة الاختيار (للمعلمة الرائدة فقط) ───────────────────────────
  function openPick(targetClassId) {
    const v = state.view; if (!v) return;
    const owned = (v.me && v.me.ownedClassIds) || [];
    if (!owned.length) return;
    const classId = (targetClassId && owned.includes(targetClassId)) ? targetClassId : owned[0];
    const host = document.querySelector('[data-stw-class="' + classId + '"][data-stw-pick]')
      || document.querySelector('[data-stw-pick]');
    if (!host) return;
    const d = (typeof loadDB === 'function') ? loadDB() : {};
    const list = (d.students || []).filter(s => s && s.classId === classId && !s.deleted);
    const cur = (v.stars || []).find(x => x.classId === classId);
    const chosen = {};
    (cur ? cur.traits : []).forEach(t => { chosen[t] = 1; });
    let studentId = cur ? cur.studentId : '';
    let msg = cur ? cur.message : '';

    host.innerHTML = '<div class="stw-list" style="margin-top:10px">'
      + list.map(s => '<div class="stw-row' + (s.id === studentId ? ' on' : '')
        + '" data-stw-sid="' + esc(s.id) + '">' + esc(s.fullName || s.id) + '</div>').join('')
      + '</div>'
      + '<div class="stw-chips">'
      + (state.traits || []).map(t => '<button type="button" class="stw-chip' + (chosen[t.id] ? ' on' : '')
        + '" data-stw-tid="' + esc(t.id) + '">' + esc(t.emoji + ' ' + t.label) + '</button>').join('')
      + '</div>'
      + '<input class="input" data-stw-msg maxlength="140" placeholder="عبارة قصيرة عن سبب الاختيار (اختياري)" style="width:100%">'
      + '<div class="stw-actions">'
      + '<button class="stw-btn" onclick="__stwSavePick(\'' + esc(classId) + '\')">حفظ النجمة</button>'
      + '<button class="stw-btn ghost" onclick="this.closest(\'[data-stw-pick]\').innerHTML=\'\'">إلغاء</button>'
      + '</div>';
    const mi = host.querySelector('[data-stw-msg]');
    if (mi) {
      mi.value = msg || '';
      mi.oninput = () => { msg = mi.value; };
    }
    host.querySelectorAll('[data-stw-sid]').forEach(el => {
      el.onclick = () => {
        studentId = el.getAttribute('data-stw-sid');
        host.querySelectorAll('[data-stw-sid]').forEach(x => x.classList.remove('on'));
        el.classList.add('on');
      };
    });
    host.querySelectorAll('[data-stw-tid]').forEach(el => {
      el.onclick = () => {
        const id = el.getAttribute('data-stw-tid');
        if (chosen[id]) delete chosen[id]; else chosen[id] = 1;
        el.classList.toggle('on');
      };
    });
    host.__stwPick = () => ({ classId, studentId, message: msg, traits: Object.keys(chosen) });
  }

  function savePick(targetClassId) {
    let host = null;
    if (targetClassId) {
      host = document.querySelector('[data-stw-class="' + targetClassId + '"][data-stw-pick]');
    }
    if (!host) {
      const allHosts = document.querySelectorAll('[data-stw-pick]');
      for (let i = 0; i < allHosts.length; i++) {
        if (allHosts[i].__stwPick) { host = allHosts[i]; break; }
      }
    }
    if (!host) host = document.querySelector('[data-stw-pick]');
    const g = host && host.__stwPick ? host.__stwPick() : null;
    if (!g || !g.studentId) { alert('اختاري الطالبة أولًا'); return; }
    api('award', g).then(r => {
      if (r.ok && r.j && r.j.ok) { state.view = r.j; state.traits = r.j.traits || []; return paint(); }
      const code = (r.j && r.j.error) || 'save_failed';
      if (code === 'not_owner') alert('لست رائدة هذا الفصل — النظام يمنح التعديل لغيرك.');
      else if (code === 'student_not_in_class') alert('الطالبة لا تنتمي إلى هذا الفصل.');
      else if (code === 'bad_traits') alert('اختاري صفة على الأقل.');
      else alert('تعذّر حفظ النجمة: ' + code);
    });
  }

  // ── 7) الربط: أي re-render في التطبيق يحدّث البطاقات ───────────────────
  window.__stwOpenPick = openPick;
  window.__stwSavePick = savePick;
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

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

test('Star of the Week - Client Guards & Loop Prevention', async (t) => {
  const html = fs.readFileSync('public/index.html', 'utf8');

  // 1. In-flight guard and cache variables
  assert.match(html, /const __starOfWeekLoading = \{\};/, '__starOfWeekLoading guard must exist');
  assert.match(html, /const __starOfWeekLastFetch = \{\};/, '__starOfWeekLastFetch cache must exist');
  assert.match(html, /const STAR_CACHE_TTL_MS = 15000;/, 'STAR_CACHE_TTL_MS must be defined');

  // 2. Draft state and dirty flag
  assert.match(html, /let starDraft = null;/, 'starDraft must exist');
  assert.match(html, /let isStarFormDirty = false;/, 'isStarFormDirty must exist');

  // 3. Loop breaker in renderStarOfWeek
  assert.match(html, /if\(!res \|\| !res\.changed\) return;/, 'renderStarOfWeek must return if no change');
  assert.match(html, /if\(isStarFormDirty\) return;/, 'renderStarOfWeek must return if user is typing');

  // 4. Input events binding to starDraft
  assert.match(html, /id="starNameInput"[\s\S]*?oninput="starDraft = starDraft \|\| \{\}; starDraft\.name = this\.value; isStarFormDirty = true;"/, 'starNameInput must bind oninput to starDraft');
  assert.match(html, /id="starClassInput"[\s\S]*?oninput="starDraft = starDraft \|\| \{\}; starDraft\.className = this\.value; isStarFormDirty = true;"/, 'starClassInput must bind oninput to starDraft');

  // 5. Handling star === null
  assert.match(html, /delete __starOfWeekCache\[school\];/, 'Null star must delete cache');
  assert.match(html, /localStorage\.removeItem\('nibras_starOfWeek_' \+ school\);/, 'Null star must remove item from localStorage');
});

test('Star of the Week - Server Logic & Merging', async (t) => {
  const serverJs = fs.readFileSync('server.js', 'utf8');

  // 1. Check server POST dual sync to app_settings and school_data
  assert.match(serverJs, /await db\.setSchoolSettings\(school, merged\);/, 'POST must update app_settings');
  assert.match(serverJs, /await db\.mutateSchoolData\(school,[\s\S]*?if \(star\) d\.starOfWeek = star;\s*else delete d\.starOfWeek;/, 'POST must sync starOfWeek into school_data');

  // 2. Check server GET fallback
  assert.match(serverJs, /if \(!star\) \{[\s\S]*?const rec = await db\.getSchoolData\(school\);/, 'GET must fallback to school_data if app_settings is empty');

  // 3. Check merging logic in server.js does not resurrect null star
  assert.match(serverJs, /if \(b === null && canManageStar\) \{[\s\S]*?merged\[key\] = null;\s*continue;/, 'Server merging must accept null without resurrection');
});

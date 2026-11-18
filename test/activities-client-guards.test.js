'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

test('Activities Client Guards & Loop Prevention', async (t) => {
  const html = fs.readFileSync('public/index.html', 'utf8');

  // Verify activityFormOpen exists
  assert.match(html, /let activityFormOpen = false;/, 'activityFormOpen state must be declared');

  // Verify in-flight guard
  assert.match(html, /if\(__activitiesLoading\[school\]\)/, 'In-flight guard must be present');

  // Verify Cache TTL check
  assert.match(html, /now - __activitiesLastFetch\[school\] < ACTIVITIES_CACHE_TTL_MS/, 'Cache TTL check must be present');

  // Verify changed calculation
  assert.match(html, /const changed = prevSerialized !== nextSerialized;/, 'Change detection must compare serialized data');

  // Verify render loop breaker
  assert.match(html, /if\(!res \|\| !res\.changed\) return;/, 'renderActivities must abort if data did not change');
  assert.match(html, /if\(activityFormOpen\) return;/, 'renderActivities must not re-render if form is open');

  // Verify openActivityForm sets state
  assert.match(html, /function openActivityForm\(\)\{[\s\S]*?activityFormOpen = true;/, 'openActivityForm must set activityFormOpen to true');

  // Verify closeActivityForm resets state
  assert.match(html, /function closeActivityForm\(\)\{[\s\S]*?activityFormOpen = false;/, 'closeActivityForm must reset activityFormOpen to false');

  // Verify saveActivity and deleteActivity reset state
  assert.match(html, /async function saveActivity\(\)\{[\s\S]*?activityFormOpen = false;/, 'saveActivity must reset activityFormOpen');
  assert.match(html, /async function deleteActivity\(id\)\{[\s\S]*?activityFormOpen = false;/, 'deleteActivity must reset activityFormOpen');

  // Verify editActivity sets state
  assert.match(html, /function editActivity\(id\)\{[\s\S]*?activityFormOpen = true;/, 'editActivity must set activityFormOpen to true');
});

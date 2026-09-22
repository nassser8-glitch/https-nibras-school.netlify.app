const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('public/index.html', 'utf8');
const match = html.match(/function __mergeLocalStudents\(serverStudents, localStudents\)\{[\s\S]*?\n\}/);
assert.ok(match, 'student merge helper should exist in the client');

const merge = vm.runInNewContext(`(${match[0]})`);

const oldStudent = { id: 'old', fullName: 'قديم' };
const newStudent = { id: 'new', fullName: 'مضاف حديثاً' };
const result = merge([oldStudent], [oldStudent, newStudent]);

assert.deepEqual(JSON.parse(JSON.stringify(result)), [oldStudent, newStudent]);
assert.notStrictEqual(result[1], newStudent, 'local records must be copied before storage');
assert.deepEqual(JSON.parse(JSON.stringify(merge([], [newStudent]))), [newStudent]);
console.log('sync-student-merge: ok');

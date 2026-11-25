'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

function extractFn(name) {
  const i = HTML.search(new RegExp('function\\s+' + name + '\\s*\\('));
  assert.ok(i >= 0, 'Missing function ' + name);
  const open = HTML.indexOf('{', i);
  let d = 0;
  for (let k = open; k < HTML.length; k++) {
    if (HTML[k] === '{') d++;
    else if (HTML[k] === '}') {
      d--;
      if (d === 0) return HTML.slice(i, k + 1);
    }
  }
  throw new Error('Unbalanced ' + name);
}

test('استخراج الاسم الثنائي بشكل صحيح مع «بن» و«عبد» دون اقتطاع', () => {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(extractFn('twoPartNameOf'), ctx);

  const cases = [
    ['ناصر بن عبدالعزيز العتيبي', 'ناصر بن عبدالعزيز'],
    ['محمد بن عبدالله العتيبي', 'محمد بن عبدالله'],
    ['عبدالعزيز بن محمد العتيبي', 'عبدالعزيز بن محمد'],
    ['عبدالرحمن محمد العتيبي', 'عبدالرحمن محمد'],
    ['عبد الله بن محمد العتيبي', 'عبد الله بن محمد'],
    ['عبدالعزيز بن محمد بن سعود العتيبي', 'عبدالعزيز بن محمد'],
    ['محمد بن عبد الله العتيبي', 'محمد بن عبد الله'],
    ['سارة بنت عبد الرحمن العتيبي', 'سارة بنت عبد الرحمن'],
    ['أحمد علي محمد', 'أحمد علي'],
    ['عبد الله', 'عبد الله'],
    ['محمد', 'محمد'],
    ['', ''],
  ];

  for (const [input, expected] of cases) {
    assert.strictEqual(ctx.twoPartNameOf(input), expected, `Failed for: ${input}`);
  }
});

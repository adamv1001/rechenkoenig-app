import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  generate,
  getPools,
  hint,
  isCrossing,
  nextAnswer,
  pickTask,
  remainingSeconds,
  sanitizeConfig,
  taskKey
} from '../app.js';

function mulberry32(seed) {
  let value = seed;
  return () => {
    value |= 0;
    value = value + 0x6D2B79F5 | 0;
    let t = Math.imul(value ^ value >>> 15, 1 | value);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

test('defaults and saved settings stay inside the allowed choices', () => {
  assert.deepEqual(sanitizeConfig(null), { range: 20, operation: 'Gemischt', mode: 'Üben' });
  assert.deepEqual(sanitizeConfig({ range: '20', operation: 'Mal', mode: 'Prüfung', score: 9 }), {
    range: 20,
    operation: 'Gemischt',
    mode: 'Üben'
  });
  assert.deepEqual(sanitizeConfig({ range: 100, operation: 'Minus', mode: 'Zeitrennen' }), {
    range: 100,
    operation: 'Minus',
    mode: 'Zeitrennen'
  });
});

test('answers stay within the selected range and drop a leading zero', () => {
  assert.equal(nextAnswer('', '0', 20), '0');
  assert.equal(nextAnswer('0', '4', 20), '4');
  assert.equal(nextAnswer('2', '0', 20), '20');
  assert.equal(nextAnswer('2', '1', 20), '2');
  assert.equal(nextAnswer('9', '9', 20), '9');
  assert.equal(nextAnswer('1', '0', 100), '10');
  assert.equal(nextAnswer('10', '0', 100), '100');
  assert.equal(nextAnswer('10', '1', 100), '10');
  assert.equal(nextAnswer('5', '0', 50), '50');
  assert.equal(nextAnswer('5', '1', 50), '5');
});

test('race time stays between 0 and 60 seconds', () => {
  const now = 1_000_000;
  assert.equal(remainingSeconds(now + 60000, now), 60);
  assert.equal(remainingSeconds(now + 60001, now), 60);
  assert.equal(remainingSeconds(now + 59001, now), 60);
  assert.equal(remainingSeconds(now + 59000, now), 59);
  assert.equal(remainingSeconds(now, now), 0);
  assert.equal(remainingSeconds(now - 5000, now), 0);
  assert.equal(remainingSeconds(now + 120000, now), 60);
  assert.equal(remainingSeconds(0, now), 60);
});

test('crossing-ten pools match real carries and borrows', () => {
  for (const range of [20, 50, 100]) {
    for (const op of ['+', '−']) {
      const pool = getPools(range, op);
      assert.ok(pool.all.length > 0);
      assert.ok(pool.cross.length > 0);
      for (const task of pool.all) {
        assert.ok(task.a >= 0 && task.a <= range);
        assert.ok(task.b >= 0 && task.b <= range);
        assert.equal(task.result, op === '+' ? task.a + task.b : task.a - task.b);
        assert.ok(task.result >= 0 && task.result <= range);
        assert.equal(pool.cross.includes(task), isCrossing(task));
      }
    }
  }
  const minus = getPools(50, '−');
  assert.equal(isCrossing(minus.all.find((task) => task.a === 25 && task.b === 10)), false);
  assert.equal(minus.cross.some((task) => task.a === 25 && task.b === 10), false);
  assert.equal(isCrossing(minus.all.find((task) => task.a === 20 && task.b === 6)), true);
  assert.equal(minus.cross.some((task) => task.a === 20 && task.b === 6), true);
  const plus = getPools(20, '+');
  assert.equal(plus.all.some((task) => task.a === 6 && task.b === 10), true);
  assert.equal(plus.cross.some((task) => task.a === 6 && task.b === 10), false);
  assert.equal(plus.cross.some((task) => task.a === 8 && task.b === 5), true);
});

test('an empty filtered draw still returns a valid task', () => {
  const only = { a: 3, b: 2, op: '+', result: 5 };
  const task = pickTask({ all: [only], cross: [only] }, true, only, () => 1);
  assert.equal(task.result, 5);
  assert.notEqual(task, only);
});

test('mixed practice is mostly minus and mostly crossing ten', () => {
  const rng = mulberry32(20261107);
  let minus = 0;
  let crossing = 0;
  const total = 4000;
  let previous;
  for (let i = 0; i < total; i += 1) {
    const task = generate(20, 'Gemischt', previous, rng);
    assert.ok(task);
    assert.ok(task.result >= 0 && task.result <= 20);
    if (previous) assert.notEqual(taskKey(task), taskKey(previous));
    if (task.op === '−') minus += 1;
    if (isCrossing(task)) crossing += 1;
    previous = task;
  }
  assert.ok(minus / total > 0.66 && minus / total < 0.74, `minus ratio ${minus / total}`);
  assert.ok(crossing / total > 0.72, `crossing ratio ${crossing / total}`);
});

test('pure plus and minus stay on that operation', () => {
  const rng = mulberry32(7);
  for (let i = 0; i < 30; i += 1) {
    assert.equal(generate(100, 'Plus', null, rng).op, '+');
    assert.equal(generate(100, 'Minus', null, rng).op, '−');
  }
});

test('hints stay friendly and do not print the final result', () => {
  assert.match(hint({ a: 8, b: 0, op: '+' }), /bleibt gleich/);
  assert.equal(hint({ a: 12, b: 5, op: '−' }), 'Rechne zuerst bis 10: 12 − 2 = 10. Ziehe dann noch 3 ab.');
  assert.equal(hint({ a: 8, b: 5, op: '+' }), 'Rechne zuerst bis 10: 8 + 2 = 10. Rechne dann noch 3 dazu.');
  assert.equal(hint({ a: 42, b: 17, op: '−' }), 'Rechne zuerst bis 40: 42 − 2 = 40. Ziehe dann 10 und noch 5 ab.');
  assert.match(hint({ a: 20, b: 6, op: '−' }), /Gehe 10 zurück zu 10/);
  assert.equal(hint({ a: 6, b: 1, op: '+' }), 'Starte bei 6. Zähle 1 Schritt weiter.');
  assert.match(hint({ a: 25, b: 10, op: '−' }), /Zehner/);
  assert.doesNotMatch(hint({ a: 6, b: 20, op: '+' }), /und 0|= 26/);
  for (const range of [20, 50, 100]) {
    for (const op of ['+', '−']) {
      for (const task of getPools(range, op).all) {
        const text = hint(task);
        assert.match(text, /\S/);
        assert.doesNotMatch(text, /undefined|NaN|Witz|haha|lustig/i);
        assert.doesNotMatch(text, new RegExp(`=\\s*${task.result}(?!\\d)`));
      }
    }
  }
});

test('published files stay generic, relative, and silent', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const manifest = JSON.parse(readFileSync(new URL('../manifest.webmanifest', import.meta.url), 'utf8'));
  const published = `${html}\n${app}\n${sw}\n${readme}\n${JSON.stringify(manifest)}`;
  assert.equal(manifest.start_url, '/rechenkoenig-app/');
  assert.equal(manifest.scope, '/rechenkoenig-app/');
  assert.equal(manifest.id, '/rechenkoenig-app/');
  assert.ok(manifest.start_url.startsWith(manifest.scope));
  assert.ok(manifest.icons.every((icon) => icon.src.startsWith('./')));
  assert.match(html, /src="\.\/app\.js"/);
  assert.match(html, /href="\.\/manifest\.webmanifest"/);
  assert.match(html, /href="\.\/apple-touch-icon\.png"/);
  assert.match(sw, /rechenkoenig-app-/);
  assert.match(sw, /startsWith\(PREFIX\)/);
  assert.match(sw, /\.\/app\.js/);
  assert.doesNotMatch(html, /(?:src|href)="(?:https?:)?\/(?!\/)/);
  assert.doesNotMatch(published, /Bastian|AudioContext|new Audio\(|<audio|speechSynthesis|navigator\.vibrate|Witz/i);
});

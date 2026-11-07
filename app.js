const STORAGE_KEY = 'rechenkoenig-offline-v1';
const RANGES = [20, 50, 100];
const OPERATIONS = ['Plus', 'Minus', 'Gemischt'];
const MODES = ['Üben', 'Zeitrennen'];
const DEFAULTS = { range: 20, operation: 'Gemischt', mode: 'Üben' };
const pools = new Map();

export function sanitizeConfig(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    range: RANGES.includes(source.range) ? source.range : DEFAULTS.range,
    operation: OPERATIONS.includes(source.operation) ? source.operation : DEFAULTS.operation,
    mode: MODES.includes(source.mode) ? source.mode : DEFAULTS.mode
  };
}

export function nextAnswer(current, digit, range) {
  if (typeof digit !== 'string' || !/^[0-9]$/.test(digit)) return current;
  if (!RANGES.includes(range)) return current;
  const next = current === '0' ? digit : `${current}${digit}`;
  if (next.length > String(range).length) return current;
  if (Number(next) > range) return current;
  return next;
}

export function remainingSeconds(deadline, now) {
  if (!deadline) return 60;
  const seconds = Math.ceil((deadline - now) / 1000);
  if (seconds < 0) return 0;
  if (seconds > 60) return 60;
  return seconds;
}

export function isCrossing(task) {
  const onesA = task.a % 10;
  const onesB = task.b % 10;
  if (task.op === '−') return onesB > onesA;
  if (task.op === '+') return onesA > 0 && onesA + onesB > 10;
  return false;
}

export function taskKey(task) {
  return `${task.a}${task.op}${task.b}`;
}

export function getPools(range, op) {
  const key = `${range}${op}`;
  const existing = pools.get(key);
  if (existing) return existing;
  const all = [];
  const cross = [];
  for (let a = 0; a <= range; a += 1) {
    for (let b = 0; b <= range; b += 1) {
      const result = op === '+' ? a + b : a - b;
      if (result < 0 || result > range) continue;
      const task = { a, b, op, result };
      all.push(task);
      if (isCrossing(task)) cross.push(task);
    }
  }
  const pool = { all, cross };
  pools.set(key, pool);
  return pool;
}

function exclude(list, previous) {
  if (!previous) return list.slice();
  const key = taskKey(previous);
  return list.filter((task) => taskKey(task) !== key);
}

export function pickTask(pool, preferCross, previous, rng) {
  const primary = preferCross && pool.cross.length > 0 ? pool.cross : pool.all;
  let filtered = exclude(primary, previous);
  if (filtered.length === 0) filtered = exclude(pool.all, previous);
  if (filtered.length === 0) filtered = pool.all.slice();
  const index = Math.min(filtered.length - 1, Math.floor(rng() * filtered.length));
  return { ...filtered[index] };
}

export function generate(range, operation, previous, rng = Math.random) {
  const op = operation === 'Minus' ? '−' : operation === 'Plus' ? '+' : (rng() < 0.7 ? '−' : '+');
  const pool = getPools(range, op);
  const preferCross = rng() < 0.75;
  return pickTask(pool, preferCross, previous, rng);
}

function countHint(a, b, backward) {
  const word = b === 1 ? 'Schritt' : 'Schritte';
  const direction = backward ? 'rückwärts' : 'weiter';
  return `Starte bei ${a}. Zähle ${b} ${word} ${direction}.`;
}

function stepMinus(a, toTen, rest) {
  const atTen = a - toTen;
  if (rest >= 10) {
    const tens = Math.floor(rest / 10) * 10;
    const ones = rest % 10;
    if (ones === 0) {
      return `Rechne zuerst bis ${atTen}: ${a} − ${toTen} = ${atTen}. Ziehe dann ${tens} ab.`;
    }
    return `Rechne zuerst bis ${atTen}: ${a} − ${toTen} = ${atTen}. Ziehe dann ${tens} und noch ${ones} ab.`;
  }
  return `Rechne zuerst bis ${atTen}: ${a} − ${toTen} = ${atTen}. Ziehe dann noch ${rest} ab.`;
}

function hintMinus(a, b) {
  const onesA = a % 10;
  const onesB = b % 10;
  if (onesB > onesA && onesA > 0) return stepMinus(a, onesA, b - onesA);
  if (onesB > onesA && onesA === 0 && b < 10) {
    const back = 10 - b;
    return `Gehe 10 zurück zu ${a - 10}. Das ist ${back} zu weit. Zähle ${back} wieder dazu.`;
  }
  if (b % 10 === 0) {
    const tens = b / 10;
    return tens === 1 ? `Ziehe einen Zehner ab: ${a} − 10.` : `Ziehe ${tens} Zehner ab.`;
  }
  if (b >= 10) {
    const tens = Math.floor(b / 10) * 10;
    const ones = b % 10;
    return `Zerlege ${b} in ${tens} und ${ones}. Ziehe zuerst die Zehner ab, dann die Einer.`;
  }
  return countHint(a, b, true);
}

function stepPlus(a, toTen, rest) {
  const atTen = a + toTen;
  if (rest >= 10) {
    const tens = Math.floor(rest / 10) * 10;
    const ones = rest % 10;
    if (ones === 0) {
      return `Rechne zuerst bis ${atTen}: ${a} + ${toTen} = ${atTen}. Rechne dann noch ${tens} dazu.`;
    }
    return `Rechne zuerst bis ${atTen}: ${a} + ${toTen} = ${atTen}. Rechne dann ${tens} und noch ${ones} dazu.`;
  }
  return `Rechne zuerst bis ${atTen}: ${a} + ${toTen} = ${atTen}. Rechne dann noch ${rest} dazu.`;
}

function hintPlus(a, b) {
  const onesA = a % 10;
  const onesB = b % 10;
  if (onesA > 0 && onesA + onesB > 10) return stepPlus(a, 10 - onesA, b - (10 - onesA));
  if (b % 10 === 0) {
    const tens = b / 10;
    return tens === 1 ? `Rechne einen Zehner dazu: ${a} + 10.` : `Rechne ${tens} Zehner dazu.`;
  }
  if (b >= 10) {
    const tens = Math.floor(b / 10) * 10;
    const ones = b % 10;
    return `Zerlege ${b} in ${tens} und ${ones}. Rechne zuerst die Zehner dazu, dann die Einer.`;
  }
  return countHint(a, b, false);
}

export function hint(task) {
  if (task.b === 0) return 'Du rechnest mit 0. Die erste Zahl bleibt gleich.';
  if (task.op === '−') return hintMinus(task.a, task.b);
  return hintPlus(task.a, task.b);
}

function readStorage() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  } catch {
    return null;
  }
}

function saveConfig(config) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeConfig(config)));
  } catch {
    /* Private mode and blocked storage still leave the round usable. */
  }
}

let state = { ...DEFAULTS, phase: 'setup', task: null, answer: '', solved: false, help: false, score: 0, deadline: 0, remaining: 60 };
let root = null;

function esc(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function reset(changes = {}) {
  const config = sanitizeConfig({
    range: Object.prototype.hasOwnProperty.call(changes, 'range') ? changes.range : state.range,
    operation: Object.prototype.hasOwnProperty.call(changes, 'operation') ? changes.operation : state.operation,
    mode: Object.prototype.hasOwnProperty.call(changes, 'mode') ? changes.mode : state.mode
  });
  state = { ...config, phase: 'setup', task: null, answer: '', solved: false, help: false, score: 0, deadline: 0, remaining: 60 };
  saveConfig(config);
  render();
}

function start() {
  const config = sanitizeConfig(state);
  state = {
    ...state,
    ...config,
    phase: 'running',
    task: generate(config.range, config.operation, null),
    answer: '',
    solved: false,
    help: false,
    score: 0,
    remaining: 60,
    deadline: config.mode === 'Zeitrennen' ? Date.now() + 60000 : 0
  };
  render();
}

function expire() {
  if (state.phase !== 'running' || state.mode !== 'Zeitrennen') return false;
  if (Date.now() < state.deadline) return false;
  state.phase = 'done';
  state.remaining = 0;
  state.answer = '';
  render();
  return true;
}

function digit(d) {
  if (expire() || state.phase !== 'running' || state.solved) return;
  const next = nextAnswer(state.answer, d, state.range);
  if (next === state.answer) return;
  state.answer = next;
  updateAnswer();
}

function erase() {
  if (expire() || state.phase !== 'running' || state.solved) return;
  state.answer = state.answer.slice(0, -1);
  updateAnswer();
}

function check() {
  if (expire() || state.phase !== 'running' || state.solved || state.answer === '') return;
  if (Number(state.answer) === state.task.result) {
    state.solved = true;
    state.help = false;
    state.score += 1;
  } else {
    state.help = true;
    state.answer = '';
  }
  render();
}

function next() {
  if (expire() || state.phase !== 'running' || !state.solved) return;
  state.task = generate(state.range, state.operation, state.task);
  state.answer = '';
  state.solved = false;
  state.help = false;
  render();
}

function updateAnswer() {
  const answer = document.getElementById('answer');
  const checkButton = document.getElementById('check');
  const eraseButton = document.getElementById('erase');
  if (answer) answer.textContent = state.answer || '…';
  const blocked = state.solved || state.answer === '';
  if (checkButton) checkButton.disabled = blocked;
  if (eraseButton) eraseButton.disabled = blocked;
}

function tick() {
  if (state.phase !== 'running' || state.mode !== 'Zeitrennen') return;
  if (expire()) return;
  const remaining = remainingSeconds(state.deadline, Date.now());
  if (remaining === state.remaining) return;
  state.remaining = remaining;
  const clock = document.getElementById('clock');
  const progress = document.getElementById('progress');
  if (clock) clock.textContent = `${remaining} Sekunden`;
  if (progress) progress.value = String(remaining);
}

function choices(label, field, values) {
  const buttons = values.map((value) => {
    const pressed = String(state[field]) === String(value);
    return `<button type="button" data-field="${field}" data-value="${esc(value)}" aria-pressed="${pressed}">${esc(value)}</button>`;
  }).join('');
  return `<fieldset><legend>${esc(label)}</legend><div class="choices">${buttons}</div></fieldset>`;
}

function setupView() {
  const modeText = state.mode === 'Üben'
    ? 'Ganz in Ruhe. Du hast so viel Zeit, wie du brauchst.'
    : 'Du hast 60 Sekunden. Die Zeit beginnt erst mit Start.';
  const startLabel = state.mode === 'Üben' ? 'Üben starten' : 'Zeitrennen starten';
  return [
    choices('1. Deine Zahlen', 'range', RANGES),
    choices('2. Was rechnest du?', 'operation', OPERATIONS),
    '<p class="small">Gemischt: mehr Minus als Plus. Oft geht es über den Zehner.</p>',
    choices('3. So übst du', 'mode', MODES),
    `<p>${esc(modeText)}</p>`,
    `<button type="button" class="primary wide" data-action="start">${esc(startLabel)}</button>`
  ].join('');
}

function doneView() {
  const word = state.score === 1 ? 'Aufgabe' : 'Aufgaben';
  return [
    '<section>',
    '<h2>Geschafft! Die Zeit ist um.</h2>',
    `<p class="good">Du hast ${state.score} ${word} richtig gelöst.</p>`,
    '<p>Jeder Versuch hilft dir beim Lernen.</p>',
    '<button type="button" class="primary wide" data-action="start">Noch einmal starten</button>',
    '<button type="button" class="wide back" data-action="back">Zurück zur Auswahl</button>',
    '</section>'
  ].join('');
}

function feedbackView() {
  if (state.solved) {
    return '<p class="good">Richtig! Gut gerechnet.</p><button type="button" class="primary wide" data-action="next">Nächste Aufgabe</button>';
  }
  if (state.help) {
    return `<p>Noch nicht ganz. Wir rechnen in Schritten:</p><p>${esc(hint(state.task))}</p><p class="small">Du schaffst das! Tippe deine neue Antwort ein.</p>`;
  }
  return '<p class="small">Tippe die Antwort. Dann drücke Prüfen.</p>';
}

function runView() {
  const task = state.task;
  const locked = state.solved ? ' disabled' : '';
  const answerLocked = state.solved || state.answer === '';
  const clock = state.mode === 'Zeitrennen' ? `${state.remaining} Sekunden` : 'Ohne Zeitdruck';
  const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
    `<button type="button" class="digit" data-digit="${d}"${locked}>${d}</button>`
  )).join('');
  const progress = state.mode === 'Zeitrennen'
    ? `<progress id="progress" aria-label="Restzeit" max="60" value="${state.remaining}"></progress>`
    : '';
  return [
    `<div class="topline"><span>Bis ${task ? esc(state.range) : ''} · ${esc(state.operation)}</span><span id="clock">${esc(clock)}</span></div>`,
    progress,
    `<p class="small score" id="score">Richtig gelöst: ${state.score}</p>`,
    `<div class="sum">${esc(task.a)} ${esc(task.op)} ${esc(task.b)} = ?</div>`,
    `<div id="answer" class="answer" aria-label="Deine Antwort" aria-live="polite">${esc(state.answer || '…')}</div>`,
    `<div class="feedback" aria-live="polite">${feedbackView()}</div>`,
    '<div class="keys">',
    digits,
    `<button type="button" id="erase" class="action" data-action="erase"${answerLocked ? ' disabled' : ''}>Löschen</button>`,
    `<button type="button" class="digit" data-digit="0"${locked}>0</button>`,
    `<button type="button" id="check" class="primary action" data-action="check"${answerLocked ? ' disabled' : ''}>Prüfen</button>`,
    '</div>',
    '<button type="button" class="wide back" data-action="back">Zurück zur Auswahl</button>'
  ].join('');
}

function render() {
  if (!root) return;
  if (state.phase === 'setup') root.innerHTML = setupView();
  else if (state.phase === 'done') root.innerHTML = doneView();
  else root.innerHTML = runView();
  window.scrollTo(0, 0);
}

function onAppClick(event) {
  if (event.detail === 0) return;
  const button = event.target.closest('button');
  if (!button || button.disabled) return;
  if (button.dataset.field) {
    const field = button.dataset.field;
    const value = field === 'range' ? Number(button.dataset.value) : button.dataset.value;
    reset({ [field]: value });
    return;
  }
  if (button.dataset.digit !== undefined) {
    digit(button.dataset.digit);
    return;
  }
  const action = button.dataset.action;
  if (action === 'start') start();
  else if (action === 'back') reset();
  else if (action === 'erase') erase();
  else if (action === 'check') check();
  else if (action === 'next') next();
}

function onKeyDown(event) {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const key = event.key;
  const digitKey = key.length === 1 && key >= '0' && key <= '9';
  const activatesButton = key === 'Enter' || key === ' ' || key === 'NumpadEnter';
  if (!digitKey && !activatesButton && key !== 'Backspace') return;
  const inApp = event.target instanceof Element && Boolean(event.target.closest('#app'));
  if (digitKey || key === 'Backspace' || (activatesButton && inApp)) {
    event.preventDefault();
    event.stopPropagation();
  }
}

function shellUrls() {
  const base = new URL('./', location.href);
  return ['', 'index.html', 'app.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png']
    .map((asset) => new URL(asset || '.', base).href);
}

async function cacheIsComplete() {
  const needed = shellUrls();
  const keys = await caches.keys();
  for (const key of keys) {
    if (!key.startsWith('rechenkoenig-app-')) continue;
    const cache = await caches.open(key);
    const hrefs = new Set((await cache.keys()).map((request) => request.url.split('#')[0].split('?')[0]));
    if (needed.every((url) => hrefs.has(url))) return true;
  }
  return false;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function whenControlled() {
  if (navigator.serviceWorker.controller) return true;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(Boolean(navigator.serviceWorker.controller)), 10000);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      clearTimeout(timer);
      resolve(true);
    }, { once: true });
  });
}

async function workerAgrees() {
  const worker = navigator.serviceWorker.controller;
  if (!worker) return false;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      navigator.serviceWorker.removeEventListener('message', onMessage);
      resolve(false);
    }, 4000);
    function onMessage(event) {
      if (!event.data || event.data.type !== 'rechenkoenig-cache-status') return;
      clearTimeout(timer);
      navigator.serviceWorker.removeEventListener('message', onMessage);
      resolve(event.data.ready === true);
    }
    navigator.serviceWorker.addEventListener('message', onMessage);
    worker.postMessage({ type: 'rechenkoenig-cache-status' });
  });
}

async function updateOfflineStatus() {
  const el = document.getElementById('offline-status');
  if (!el) return;
  if (!('serviceWorker' in navigator) || !window.isSecureContext) {
    el.textContent = 'Offline-Installation braucht eine HTTPS-Webadresse.';
    return;
  }
  try {
    await navigator.serviceWorker.register('./sw.js', { scope: './' });
  } catch {
    if (!navigator.serviceWorker.controller) {
      el.textContent = 'Offline-Speicher nicht bereit. Bitte online neu öffnen.';
      return;
    }
  }
  const controlled = await whenControlled();
  const ready = controlled && await cacheIsComplete() && await workerAgrees();
  el.textContent = ready
    ? 'Bereit für offline auf diesem Gerät'
    : 'Offline-Speicher nicht bereit. Bitte online neu öffnen.';
}

function init() {
  root = document.getElementById('app');
  state = {
    ...sanitizeConfig(readStorage()),
    phase: 'setup',
    task: null,
    answer: '',
    solved: false,
    help: false,
    score: 0,
    deadline: 0,
    remaining: 60
  };
  root.addEventListener('click', onAppClick);
  document.addEventListener('keydown', onKeyDown, true);
  setInterval(tick, 100);
  document.addEventListener('visibilitychange', tick);
  render();
  updateOfflineStatus();
}

if (typeof document !== 'undefined') init();

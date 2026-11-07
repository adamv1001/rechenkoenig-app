import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire('/tmp/pwa-deps/package.json');
const puppeteer = require('puppeteer-core');

const PORT = 8765;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const APP = `${ORIGIN}/rechenkoenig-app/`;
const shots = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(fn, message, timeout = 15000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    last = await fn();
    if (last) return last;
    await sleep(100);
  }
  throw new Error(`${message}. Last: ${JSON.stringify(last)}`);
}

function startServer(root) {
  const child = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1', '--directory', root], {
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  child.stdout.on('data', (chunk) => { logs += chunk; });
  child.stderr.on('data', (chunk) => { logs += chunk; });
  child.logs = () => logs;
  return child;
}

async function waitForServer() {
  const start = Date.now();
  while (Date.now() - start < 8000) {
    try {
      const response = await fetch(APP);
      if (response.ok) return;
    } catch {
      /* server still starting */
    }
    await sleep(100);
  }
  throw new Error('Local server did not start');
}

async function tap(page, selector) {
  const element = await page.waitForSelector(selector, { timeout: 5000 });
  await page.evaluate((sel) => {
    document.querySelector(sel)?.scrollIntoView({ block: 'center', inline: 'center' });
  }, selector);
  const box = await element.boundingBox();
  assert(box, `No box for ${selector}`);
  await page.touchscreen.tap(box.x + Math.min(box.width / 2, 20), box.y + box.height / 2);
  await sleep(80);
}

async function readTask(page) {
  const text = await page.$eval('.sum', (el) => el.textContent);
  const match = text.match(/(\d+)\s*([+\u2212])\s*(\d+)/);
  assert(match, `Unreadable task: ${text}`);
  const a = Number(match[1]);
  const b = Number(match[3]);
  return { a, b, op: match[2], result: match[2] === '+' ? a + b : a - b, text };
}

async function enterNumber(page, value) {
  for (const digit of String(value)) {
    await tap(page, `button[data-digit="${digit}"]`);
  }
}

async function layoutMetrics(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const keys = document.querySelector('.keys');
    const keyRect = keys ? keys.getBoundingClientRect() : null;
    const buttons = [...document.querySelectorAll('.keys button, .choices button, button')].map((button) => {
      const rect = button.getBoundingClientRect();
      return { label: button.textContent.trim(), w: rect.width, h: rect.height };
    });
    const sum = document.querySelector('.sum');
    const sumRect = sum ? sum.getBoundingClientRect() : null;
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      keyTop: keyRect ? keyRect.top : null,
      keyBottom: keyRect ? keyRect.bottom : null,
      innerHeight: window.innerHeight,
      sumRight: sumRect ? sumRect.right : null,
      buttons
    };
  });
}

function assertNoOverflow(metrics, label) {
  assert(metrics.scrollWidth <= metrics.clientWidth + 1, `${label} horizontal overflow ${JSON.stringify(metrics)}`);
}

function assertTargets(metrics, label, min) {
  const tooSmall = metrics.buttons.filter((button) => button.w < min || button.h < min || button.w < 44 || button.h < 44);
  assert(tooSmall.length === 0, `${label} small targets ${JSON.stringify(tooSmall)}`);
}

async function shot(page, name, fullPage = false) {
  const path = `/tmp/${name}.png`;
  await page.screenshot({ path, fullPage });
  shots.push(path);
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), 'rechenkoenig-pages-'));
  mkdirSync(join(root, 'sibling'));
  writeFileSync(join(root, 'sibling/index.html'), '<!doctype html><title>sibling</title><p>Geschwister</p>');
  symlinkSync('/workspace', join(root, 'rechenkoenig-app'));
  const server = startServer(root);
  const logs = [];
  let browser;
  try {
    await waitForServer();
    browser = await puppeteer.launch({
      executablePath: '/usr/bin/google-chrome',
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });
    const page = await browser.newPage();
    page.on('console', (msg) => logs.push(`console ${msg.type()} ${msg.text()}`));
    page.on('pageerror', (err) => logs.push(`pageerror ${err.message}`));
    await page.evaluateOnNewDocument(() => {
      const real = Date.now.bind(Date);
      let extra = 0;
      Date.now = () => real() + extra;
      window.__setExtra = (ms) => { extra = ms; };
    });

    await page.goto(`${ORIGIN}/sibling/`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(async () => {
      const sibling = await caches.open('sibling-app-v3');
      await sibling.put('/sibling/index.html', new Response('sibling'));
      const oldApp = await caches.open('rechenkoenig-app-v0');
      await oldApp.put('/rechenkoenig-app/old', new Response('old'));
    });

    await page.setViewport({ width: 360, height: 740, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    await page.goto(APP, { waitUntil: 'domcontentloaded' });
    const secure = await page.evaluate(() => window.isSecureContext);
    assert(secure, '127.0.0.1 should be a secure context for the service worker');
    await waitFor(async () => {
      const text = await page.$eval('#offline-status', (el) => el.textContent);
      return text.includes('Bereit für offline') ? text : '';
    }, 'offline status did not become ready');

    const cacheInfo = await page.evaluate(async () => {
      const keys = await caches.keys();
      const cachesWithUrls = [];
      for (const key of keys) {
        const cache = await caches.open(key);
        const urls = (await cache.keys()).map((request) => request.url);
        cachesWithUrls.push({ key, urls });
      }
      const registration = await navigator.serviceWorker.getRegistration();
      return {
        keys,
        cachesWithUrls,
        scope: registration ? registration.scope : null,
        controlled: Boolean(navigator.serviceWorker.controller),
        script: navigator.serviceWorker.controller ? navigator.serviceWorker.controller.scriptURL : null
      };
    });
    assert(cacheInfo.keys.includes('sibling-app-v3'), `sibling cache deleted: ${cacheInfo.keys.join(',')}`);
    assert(!cacheInfo.keys.includes('rechenkoenig-app-v0'), `old app cache kept: ${cacheInfo.keys.join(',')}`);
    assert(cacheInfo.keys.includes('rechenkoenig-app-v1'), `app cache missing: ${cacheInfo.keys.join(',')}`);
    assert(cacheInfo.scope === APP, `scope ${cacheInfo.scope}`);
    assert(cacheInfo.controlled, 'page is not controlled');
    assert(cacheInfo.script.endsWith('/rechenkoenig-app/sw.js'), cacheInfo.script);
    const appCache = cacheInfo.cachesWithUrls.find((entry) => entry.key === 'rechenkoenig-app-v1');
    for (const asset of ['', 'index.html', 'app.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png']) {
      const url = new URL(asset || '.', APP).href;
      assert(appCache.urls.includes(url), `missing ${url} in ${appCache.urls.join(' ')}`);
    }

    const manifest = await page.evaluate(async () => (await fetch('./manifest.webmanifest')).json());
    assert(manifest.start_url === '/rechenkoenig-app/', manifest.start_url);
    assert(manifest.scope === '/rechenkoenig-app/', manifest.scope);
    assert(manifest.icons.every((icon) => icon.src.startsWith('./')), JSON.stringify(manifest.icons));

    const fields = await page.$$eval('input, textarea, audio, video, [contenteditable="true"]', (els) => els.length);
    assert(fields === 0, 'keyboard or media elements are present');
    const pressed = await page.$$eval('button[aria-pressed="true"]', (els) => els.map((el) => el.textContent.trim()));
    assert(pressed.join(',') === '20,Gemischt,Üben', pressed.join(','));
    assertNoOverflow(await layoutMetrics(page), 'setup 360');

    await tap(page, 'button[data-action="start"]');
    await page.waitForSelector('.keys');
    const running = await layoutMetrics(page);
    assertNoOverflow(running, 'practice 360');
    assertTargets(running, 'practice 360', 48);
    assert(running.keyTop < 740, `keypad below 360 fold ${JSON.stringify(running)}`);
    assert(running.sumRight <= 360 + 1, `sum overflow ${running.sumRight}`);
    await shot(page, 'rechenkoenig_360_practice');

    const before = await readTask(page);
    await page.focus('button[data-digit="4"]');
    await page.keyboard.press('4');
    await page.keyboard.press('Enter');
    await page.keyboard.press(' ');
    let answer = await page.$eval('#answer', (el) => el.textContent.trim());
    assert(answer === '…', `keyboard changed the answer to ${answer}`);
    await enterNumber(page, '999');
    answer = await page.$eval('#answer', (el) => el.textContent.trim());
    assert(answer.length <= 2, `answer too long: ${answer}`);
    assert(Number(answer) <= 20, `answer above range: ${answer}`);
    if (Number(answer) === before.result) {
      await tap(page, '#erase');
      await enterNumber(page, before.result === 0 ? '1' : '0');
    }
    const scoreBefore = await page.$eval('#score', (el) => el.textContent);
    await tap(page, '#check');
    const hintVisible = await page.$eval('.feedback', (el) => el.textContent);
    assert(hintVisible.includes('Du schaffst das'), hintVisible);
    assert(!hintVisible.includes(`= ${before.result}`), hintVisible);
    const scoreAfterWrong = await page.$eval('#score', (el) => el.textContent);
    assert(scoreBefore === scoreAfterWrong, `${scoreBefore} -> ${scoreAfterWrong}`);
    assert((await page.$eval('#answer', (el) => el.textContent.trim())) === '…', 'wrong answer was kept');

    await enterNumber(page, before.result);
    await tap(page, '#check');
    const scoreAfterRight = await page.$eval('#score', (el) => el.textContent);
    assert(scoreAfterRight === 'Richtig gelöst: 1', scoreAfterRight);
    await tap(page, '#check');
    assert((await page.$eval('#score', (el) => el.textContent)) === 'Richtig gelöst: 1', 'score increased twice');
    const firstText = before.text;
    await tap(page, 'button[data-action="next"]');
    const second = await readTask(page);
    assert(second.text !== firstText, 'same task repeated immediately');
    assert(second.result >= 0 && second.result <= 20, String(second.result));

    await tap(page, 'button[data-action="back"]');
    await tap(page, 'button[data-value="100"]');
    await tap(page, 'button[data-value="Minus"]');
    await tap(page, 'button[data-action="start"]');
    await enterNumber(page, '100');
    answer = await page.$eval('#answer', (el) => el.textContent.trim());
    assert(answer === '100', answer);
    await tap(page, 'button[data-digit="1"]');
    answer = await page.$eval('#answer', (el) => el.textContent.trim());
    assert(answer === '100', `fourth digit accepted: ${answer}`);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('rechenkoenig-offline-v1')));
    assert(saved.range === 100 && saved.operation === 'Minus' && saved.mode === 'Üben', JSON.stringify(saved));
    assert(!('score' in saved) && !('answer' in saved), JSON.stringify(saved));

    await page.setViewport({ width: 768, height: 1024, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    await sleep(100);
    const tablet = await layoutMetrics(page);
    assertNoOverflow(tablet, 'tablet portrait');
    assertTargets(tablet, 'tablet portrait', 70);
    assert(tablet.keyTop < 1024, `keypad below tablet fold ${JSON.stringify(tablet)}`);
    await shot(page, 'rechenkoenig_tablet_practice');

    await page.setViewport({ width: 1024, height: 768, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    await sleep(100);
    const landscape = await layoutMetrics(page);
    assertNoOverflow(landscape, 'tablet landscape');
    assertTargets(landscape, 'tablet landscape', 44);
    assert(landscape.keyTop < 768, `keypad below landscape fold ${JSON.stringify(landscape)}`);

    await page.setViewport({ width: 360, height: 640, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    await sleep(50);
    assertNoOverflow(await layoutMetrics(page), '360x640');

    await page.setViewport({ width: 360, height: 740, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    await tap(page, 'button[data-action="back"]');
    await tap(page, 'button[data-value="20"]');
    await tap(page, 'button[data-value="Plus"]');
    await tap(page, 'button[data-value="Zeitrennen"]');
    await tap(page, 'button[data-action="start"]');
    const clock = await page.$eval('#clock', (el) => el.textContent.trim());
    const progress = await page.$eval('#progress', (el) => ({ value: Number(el.value), max: Number(el.max) }));
    assert(clock === '60 Sekunden', clock);
    assert(progress.max === 60 && progress.value === 60, JSON.stringify(progress));
    await page.evaluate(() => window.__setExtra(10000));
    await sleep(300);
    const mid = await page.$eval('#clock', (el) => el.textContent.trim());
    const midProgress = await page.$eval('#progress', (el) => Number(el.value));
    const midSeconds = Number(mid.replace(' Sekunden', ''));
    assert(midSeconds >= 48 && midSeconds <= 50, mid);
    assert(midProgress >= 48 && midProgress <= 50, String(midProgress));
    const raceTask = await readTask(page);
    const raceAnswer = raceTask.result === 0 ? '1' : '0';
    await enterNumber(page, raceAnswer);
    await tap(page, '#check');
    assert((await page.$eval('#score', (el) => el.textContent)) === 'Richtig gelöst: 0', 'wrong race answer scored');
    await enterNumber(page, raceTask.result);
    await tap(page, '#check');
    assert((await page.$eval('#score', (el) => el.textContent)) === 'Richtig gelöst: 1', 'race score missed');
    const stillBounded = await page.$eval('#progress', (el) => Number(el.value));
    assert(stillBounded >= 0 && stillBounded <= 60, String(stillBounded));
    await page.evaluate(() => window.__setExtra(70000));
    await sleep(300);
    const done = await page.$eval('h2', (el) => el.textContent);
    assert(done.includes('Die Zeit ist um'), done);
    const doneScore = await page.$eval('.good', (el) => el.textContent);
    assert(doneScore.includes('1 Aufgabe'), doneScore);
    await shot(page, 'rechenkoenig_race_done');

    await page.setOfflineMode(true);
    const reloaded = await page.reload({ waitUntil: 'domcontentloaded', timeout: 10000 });
    assert(reloaded && reloaded.ok(), `offline reload status ${reloaded && reloaded.status()}`);
    await page.waitForSelector('h1');
    await waitFor(async () => {
      const text = await page.$eval('#offline-status', (el) => el.textContent);
      return text.includes('Bereit für offline') ? text : '';
    }, 'offline reload did not report ready');
    assert((await page.$eval('h1', (el) => el.textContent)) === 'Rechenkönig');
    const offlinePage = await browser.newPage();
    offlinePage.on('pageerror', (err) => logs.push(`offline pageerror ${err.message}`));
    await offlinePage.setOfflineMode(true);
    await offlinePage.setViewport({ width: 360, height: 740, isMobile: true, hasTouch: true });
    const navigated = await offlinePage.goto(`${APP}index.html`, { waitUntil: 'domcontentloaded', timeout: 10000 });
    assert(navigated && navigated.ok(), `offline navigation status ${navigated && navigated.status()}`);
    await offlinePage.waitForSelector('h1');
    assert((await offlinePage.$eval('h1', (el) => el.textContent)) === 'Rechenkönig');
    await waitFor(async () => {
      const text = await offlinePage.$eval('#offline-status', (el) => el.textContent);
      return text.includes('Bereit für offline') ? text : '';
    }, 'fresh offline navigation did not report ready');
    await offlinePage.screenshot({ path: '/tmp/rechenkoenig_offline_reload.png', fullPage: true });
    shots.push('/tmp/rechenkoenig_offline_reload.png');

    const home = await browser.newPage();
    await home.setOfflineMode(true);
    const homeResponse = await home.goto(APP, { waitUntil: 'domcontentloaded', timeout: 10000 });
    assert(homeResponse && homeResponse.ok(), `offline home status ${homeResponse && homeResponse.status()}`);
    await home.waitForSelector('#app button');

    await page.setOfflineMode(false);
    await page.evaluate(() => localStorage.setItem('rechenkoenig-offline-v1', '{'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('button[data-value="20"]');
    const recovered = await page.$$eval('button[aria-pressed="true"]', (els) => els.map((el) => el.textContent.trim()));
    assert(recovered.join(',') === '20,Gemischt,Üben', recovered.join(','));

    assert(!logs.some((line) => line.startsWith('pageerror')), logs.join('\n'));
    mkdirSync('/opt/cursor/artifacts', { recursive: true });
    for (const path of shots) {
      copyFileSync(path, `/opt/cursor/artifacts/${path.split('/').pop()}`);
    }
    console.log('browser tests passed');
  } catch (error) {
    console.error(error);
    console.error(logs.join('\n'));
    if (server.logs) console.error(server.logs());
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    server.kill();
    rmSync(root, { recursive: true, force: true });
  }
}

await main();

// Browser-to-contract acceptance checks. Requires Node 22+ and Chromium.
// Generate the archived report with ./run.sh, start ./lab.sh, then:
// node js/test-lab-browser.mjs [http://127.0.0.1:4318]
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
const origin = process.argv[2] || 'http://127.0.0.1:4318';
assert.equal((await fetch(origin + '/evidence')).status, 200, 'Run ./run.sh to generate comparison evidence before browser checks');
const root = fileURLToPath(new URL('..', import.meta.url));
const output = join(root, 'results/lab/browser');
mkdirSync(output, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'standby-lab-browser-'));
const downloads = mkdtempSync(join(output, 'downloads-'));
const browser = spawn(process.env.CHROMIUM_BIN || 'chromium', ['--headless', '--no-sandbox',
  '--disable-dev-shm-usage', '--disable-gpu', '--user-data-dir=' + profile,
  '--remote-debugging-port=0', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket;
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Chromium did not start')), 20_000);
    browser.once('error', error => { clearTimeout(timer); reject(error); });
    browser.stderr.on('data', bytes => {
      const found = String(bytes).match(/DevTools listening on (ws:\/\/\S+)/);
      if (found) { clearTimeout(timer); resolve(found[1]); }
    });
  });
  const tabs = await (await fetch(endpoint.replace('ws:', 'http:').replace(/\/devtools\/browser\/.*/, '/json/list'))).json();
  socket = new WebSocket(tabs[0].webSocketDebuggerUrl);
  await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
  let id = 0;
  const pending = new Map(), exceptions = [];
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails);
    if (!message.id) return;
    const entry = pending.get(message.id); pending.delete(message.id);
    message.error ? entry.reject(message.error) : entry.resolve(message.result);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const next = ++id; pending.set(next, { resolve, reject });
    socket.send(JSON.stringify({ id: next, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  async function until(expression, timeout = 150_000) {
    const start = Date.now();
    while (!await evaluate(expression)) {
      if (Date.now() - start > timeout) throw new Error('Browser wait timed out: ' + expression);
      await pause(250);
    }
  }
  async function click(selector, keyboard = false) {
    const position = await evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element || element.hidden || element.disabled) throw Error('Control unavailable: ' + ${JSON.stringify(selector)});
      element.scrollIntoView({ block: 'center' }); element.focus();
      const r = element.getBoundingClientRect(); return { x:r.x+r.width/2, y:r.y+r.height/2 };
    })()`);
    if (keyboard) {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    } else {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...position, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...position, button: 'left', clickCount: 1 });
    }
  }
  async function step(action, nextPhase, keyboard = false) {
    await click('[data-action="' + action + '"]', keyboard);
    await until(`document.getElementById('progress').hidden && document.getElementById('phase-label').textContent === ${JSON.stringify(nextPhase)}`);
    assert.ok(await evaluate("document.getElementById('error').hidden"), await evaluate("document.getElementById('error').textContent"));
    console.log('PASS browser', action, '→', nextPhase);
  }
  async function screenshot(name) {
    const image = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(join(output, name + '.png'), Buffer.from(image.data, 'base64'));
  }
  await send('Page.enable'); await send('Runtime.enable');
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: origin });
  await until("document.getElementById('connection').textContent === 'Sandbox controls ready'");
  const initial = await (await fetch(origin + '/api/state')).json();
  if (initial.phase !== 'idle') await step('reset', 'No job yet');
  await evaluate('window.scrollTo(0, 0)');
  await screenshot('desktop-start');
  await step('start', 'Primary active');
  await step('buy', 'Backup purchased', true);
  assert.equal(await evaluate("document.getElementById('held-payment').textContent"), '1.1 NEAR');
  await send('Page.reload');
  await until("document.getElementById('phase-label').textContent === 'Backup purchased'");
  assert.equal(await evaluate("document.getElementById('held-bond').textContent"), '0.5 NEAR');
  await step('fail_primary', 'Primary failed');
  assert.equal(await evaluate("document.getElementById('buyer-credit').textContent"), '1.5 NEAR');
  await step('activate', 'Backup active');
  const callsBefore = await evaluate("document.querySelectorAll('#activity li').length");
  await click('[data-action="invalid"]');
  await until(`document.querySelectorAll('#activity li').length === ${callsBefore + 1} && document.getElementById('progress').hidden`);
  assert.equal(await evaluate("document.querySelector('#activity li:last-child .tx-status').textContent"), 'Rejected as expected');
  assert.equal(await evaluate("document.getElementById('credits-total').textContent"), '1.5 NEAR');
  await step('deliver', 'Settlement credited');
  assert.equal(await evaluate("document.getElementById('backup-credit').textContent"), '1.6 NEAR');
  assert.match(await evaluate("document.getElementById('answer').textContent"), /Verified by the contract/);
  await screenshot('desktop-delivery');
  await step('withdraw', 'Funds withdrawn');
  assert.equal(await evaluate("document.getElementById('backup-paid').textContent"), '1.6 NEAR');
  assert.equal(await evaluate("document.getElementById('backup-credit').textContent"), '0 NEAR');
  assert.equal(await evaluate("document.getElementById('obligations').textContent"), '0 NEAR');
  await click('#download');
  for (let attempt = 0; attempt < 40; attempt++) {
    if (readdirSync(downloads).some(name => name.endsWith('.json'))) break;
    await pause(100);
  }
  const downloaded = readdirSync(downloads).find(name => name.endsWith('.json'));
  assert.ok(downloaded, 'Browser must actually download evidence');
  const exported = JSON.parse(readFileSync(join(downloads, downloaded)));
  assert.deepEqual(exported, await (await fetch(origin + '/api/state')).json());
  assert.equal(exported.phase, 'withdrawn');
  assert.ok(exported.transactions.every(tx => tx.finalized));
  await until("fetch('/evidence').then(response => response.ok)");
  await click('#comparison-details > summary');
  await until("document.getElementById('comparison-frame').contentDocument?.getElementById('benefit')?.textContent.includes('NEAR')");
  assert.equal(await evaluate("document.getElementById('comparison-frame').contentDocument.getElementById('benefit').textContent"), '+0.100 NEAR');
  assert.equal(await evaluate("document.getElementById('comparison-frame').hidden"), false);
  console.log('PASS browser refresh, keyboard activation, actual download and embedded archived comparison');

  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.ok(await evaluate('document.documentElement.scrollWidth <= 390'), 'No horizontal overflow on mobile');
  await step('reset', 'No job yet');
  await step('start', 'Primary active');
  await step('buy', 'Backup purchased');
  await step('fail_primary', 'Primary failed');
  await step('activate', 'Backup active');
  await step('fail_backup', 'Settlement credited');
  assert.equal(await evaluate("document.getElementById('buyer-credit').textContent"), '3.1 NEAR');
  assert.equal(await evaluate("document.getElementById('backup-credit').textContent"), '0 NEAR');
  assert.match(await evaluate("document.getElementById('answer').textContent"), /No verified answer/);
  assert.ok(await evaluate('document.documentElement.scrollWidth <= 390'));
  await screenshot('mobile-backup-failure');
  await step('withdraw', 'Funds withdrawn');
  assert.equal(await evaluate("document.getElementById('buyer-paid').textContent"), '3.1 NEAR');
  assert.equal(await evaluate("document.getElementById('buyer-credit').textContent"), '0 NEAR');
  assert.equal(await evaluate("document.getElementById('obligations').textContent"), '0 NEAR');
  await send('Network.enable');
  await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await until("document.getElementById('connection').textContent === 'Connection lost'", 10_000);
  assert.ok(await evaluate("Array.from(document.querySelectorAll('[data-action]')).filter(button => !button.hidden).every(button => button.disabled)"));
  await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await until("document.getElementById('connection').textContent === 'Sandbox controls ready'", 10_000);
  assert.equal(await evaluate("document.getElementById('phase-label').textContent"), 'Funds withdrawn');
  assert.deepEqual(exceptions, [], 'No uncaught browser exceptions');
  console.log('ALL FAILURE LAB BROWSER CHECKS PASSED');
} finally {
  socket?.close(); browser.kill();
  await new Promise(resolve => { if (browser.exitCode !== null || browser.signalCode !== null) resolve(); else browser.once('exit', resolve); });
  rmSync(profile, { recursive: true, force: true });
}

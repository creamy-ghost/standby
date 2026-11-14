// Fluid 68.0s video with 100% continuous Gemini 3.8 Puck voiceover (zero artificial silences)
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const framesDir = join(root, 'results/video-frames-fluid');
rmSync(framesDir, { recursive: true, force: true });
mkdirSync(framesDir, { recursive: true });

process.env.STANDBY_LAB_PORT = '4330';
console.log('Starting internal Failure Lab server on port 4330...');
await import('./lab-server.mjs');
await new Promise(r => setTimeout(r, 1500));

const origin = 'http://127.0.0.1:4330';
const profile = mkdtempSync(join(tmpdir(), 'standby-fluid-prof-'));

const browser = spawn(process.env.CHROMIUM_BIN || 'chromium', [
  '--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--user-data-dir=' + profile, '--remote-debugging-port=0', 'about:blank'
], { stdio: ['ignore', 'ignore', 'pipe'] });

const endpoint = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Chromium startup timeout')), 10000);
  browser.stderr.on('data', chunk => {
    const match = String(chunk).match(/DevTools listening on (ws:\/\/[^\s]+)/);
    if (match) { clearTimeout(timer); resolve(match[1]); }
  });
});

const tabs = await (await fetch(new URL('/json/list', endpoint.replace('ws:', 'http:')))).json();
const socket = new WebSocket(tabs[0].webSocketDebuggerUrl);
await new Promise(r => socket.addEventListener('open', r, { once: true }));

let next = 0;
const pending = new Map();
socket.onmessage = event => {
  const msg = JSON.parse(event.data);
  if (msg.id) {
    const p = pending.get(msg.id);
    if (p) {
      pending.delete(msg.id);
      msg.error ? p.reject(msg.error) : p.resolve(msg.result);
    }
  }
};

const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++next;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});

const evaluate = async expr => {
  const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails));
  return res.result.value;
};

const delay = ms => new Promise(r => setTimeout(r, ms));

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });

let currentFrame = 0;

async function captureFrames(count) {
  for (let i = 0; i < count; i++) {
    const t0 = Date.now();
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const filename = String(currentFrame++).padStart(5, '0') + '.png';
    writeFileSync(join(framesDir, filename), Buffer.from(shot.data, 'base64'));
    const elapsed = Date.now() - t0;
    const wait = Math.max(0, 100 - elapsed);
    if (wait > 0) await delay(wait);
  }
}

async function injectCaptionBar() {
  await evaluate(`(() => {
    if (document.getElementById('video-caption-bar')) return;
    const bar = document.createElement('div');
    bar.id = 'video-caption-bar';
    bar.style.cssText = 'position:fixed;bottom:32px;left:50%;transform:translateX(-50%);z-index:999999;background:rgba(8,15,12,0.95);border:1.5px solid rgba(194,245,131,0.6);box-shadow:0 12px 40px rgba(0,0,0,0.8),0 0 30px rgba(194,245,131,0.25);border-radius:9999px;padding:16px 36px;display:flex;align-items:center;gap:16px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#f3f4e9;font-size:22px;font-weight:600;letter-spacing:-0.01em;backdrop-filter:blur(16px);';
    bar.innerHTML = '<span style=\"min-width:12px;min-height:12px;border-radius:50%;background:#c2f583;box-shadow:0 0 12px #c2f583;flex-shrink:0;\"></span><span id=\"video-caption-text\"></span>';
    document.body.appendChild(bar);

    const style = document.createElement('style');
    style.textContent = '.demo-highlight { outline: 3px solid #c2f583 !important; box-shadow: 0 0 35px rgba(194,245,131,0.5) !important; transition: all 0.3s ease !important; }';
    document.head.appendChild(style);
  })()`);
}

async function setCaption(text) {
  await evaluate(`{
    const el = document.getElementById('video-caption-text');
    if (el) el.textContent = ${JSON.stringify(text)};
  }`);
}

async function highlight(selector) {
  await evaluate(`{
    document.querySelectorAll('.demo-highlight').forEach(e => e.classList.remove('demo-highlight'));
    if (${JSON.stringify(selector)}) {
      const target = document.querySelector(${JSON.stringify(selector)});
      if (target) {
        target.classList.add('demo-highlight');
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }`);
}

async function waitForAction(action, nextPhase) {
  await evaluate(`document.querySelector('[data-action="${action}"]').click()`);
  await delay(400);
  const start = Date.now();
  while (true) {
    const ready = await evaluate(`document.getElementById('progress').hidden && document.getElementById('phase-label').textContent === ${JSON.stringify(nextPhase)}`);
    if (ready) break;
    if (Date.now() - start > 180000) throw new Error('Timeout waiting for ' + action + ' -> ' + nextPhase);
    await delay(200);
  }
}

try {
  console.log('--- SCENE 1: Primary Stops; Deadline Passes (71 frames / 7.1s) ---');
  await send('Page.navigate', { url: origin });
  await delay(1200);
  await injectCaptionBar();
  await setCaption("Your worker disappears. The deadline doesn't.");
  await evaluate('window.scrollTo({ top: 0, behavior: "smooth" })');

  await captureFrames(15);
  console.log('Action: start job');
  await waitForAction('start', 'Primary active');
  await highlight('.participant.primary');
  await captureFrames(56);

  console.log('--- SCENE 2: Purchase Backup; Highlight Escrow & Bond (90 frames / 9.0s) ---');
  await setCaption("Standby locks an agreed replacement price and provider bond before failure.");
  await highlight('[data-action="buy"]');
  await captureFrames(15);

  console.log('Action: buy backup');
  await waitForAction('buy', 'Backup purchased');
  await highlight('.escrow');
  await captureFrames(55);

  console.log('Action: let primary miss deadline');
  await waitForAction('fail_primary', 'Primary failed');
  await highlight('.participant.primary');
  await captureFrames(20);

  console.log('--- SCENE 3: Activate -> Worker Delivers -> Verification -> Payment Credit (130 frames / 13.0s) ---');
  await setCaption("Backup activated → verified on-chain → payment credited and withdrawn.");
  await highlight('[data-action="activate"]');
  await captureFrames(15);

  console.log('Action: activate backup');
  await waitForAction('activate', 'Backup active');
  await highlight('[data-action="deliver"]');
  await captureFrames(15);

  console.log('Action: deliver answer');
  await waitForAction('deliver', 'Settlement credited');
  await highlight('.participant.backup');
  await captureFrames(30);

  console.log('Action: inspect task and verified answer');
  await evaluate(`document.querySelector('details.inspect').open = true`);
  await highlight('details.inspect');
  await captureFrames(30);

  console.log('Action: withdraw credited funds');
  await waitForAction('withdraw', 'Funds withdrawn');
  await highlight('.escrow');
  await captureFrames(40);

  console.log('--- SCENE 4: Cold-Retry Comparison (105 frames / 10.5s) ---');
  await send('Page.navigate', { url: origin + '/evidence' });
  await delay(1000);
  await injectCaptionBar();
  await setCaption("Cold retry hires after failure. Standby prepared beforehand.");
  await evaluate(`document.querySelector('section').scrollIntoView({ behavior: 'smooth', block: 'start' })`);
  await captureFrames(105);

  console.log('--- SCENE 5: Backup Also Fails -> Refund and Slashing (108 frames / 10.8s) ---');
  await send('Page.navigate', { url: origin });
  await delay(1000);
  await injectCaptionBar();
  await setCaption("If backup fails: contract slashes the bond and refunds the buyer.");
  
  console.log('Action: reset and run backup failure path');
  await waitForAction('reset', 'No job yet');
  await waitForAction('start', 'Primary active');
  await waitForAction('buy', 'Backup purchased');
  await waitForAction('fail_primary', 'Primary failed');
  await waitForAction('activate', 'Backup active');

  console.log('Action: make backup miss deadline');
  await highlight('[data-action="fail_backup"]');
  await captureFrames(15);
  await waitForAction('fail_backup', 'Settlement credited');
  await highlight('.participant.buyer');
  await captureFrames(93);

  console.log('--- SCENE 6: Premium, Advance Funding & Calculator (94 frames / 9.4s) ---');
  await send('Page.navigate', { url: origin + '/evidence' });
  await delay(1000);
  await injectCaptionBar();
  await setCaption("Interactive calculator: evaluate when deadline value covers the premium.");
  await evaluate(`document.querySelectorAll('section')[1].scrollIntoView({ behavior: 'smooth', block: 'center' })`);
  await captureFrames(24);

  console.log('Action: change failure slider to 20%');
  await evaluate(`{
    const el = document.getElementById('failure');
    el.value = 20;
    el.dispatchEvent(new Event('input'));
  }`);
  await captureFrames(35);

  console.log('Action: change deadline value to 15 NEAR');
  await evaluate(`{
    const el = document.getElementById('value');
    el.value = 15;
    el.dispatchEvent(new Event('input'));
  }`);
  await highlight('.big');
  await captureFrames(35);

  console.log('--- SCENE 7: Reproduction Link and Passing Checks (82 frames / 8.2s) ---');
  await send('Page.navigate', { url: origin + '/summary' });
  await delay(800);
  await injectCaptionBar();
  await setCaption("44/44 checks pass. Source and local reproduction on GitHub.");
  await captureFrames(82);

  console.log('TOTAL FRAMES CAPTURED:', currentFrame);

  // Pad audio or trim to exact length of frames
  const targetDuration = (currentFrame / 10).toFixed(2);
  console.log('Target video duration:', targetDuration, 's');

  const paddedAudio = join(root, 'results/audio/full_38_puck_fluid.wav');
  spawn('ffmpeg', ['-y', '-i', join(root, 'results/audio/full_38_puck.wav'), '-af', 'apad=whole_dur=' + targetDuration, '-to', targetDuration, paddedAudio]);
  await delay(1000);

  console.log('Muxing fluid video with continuous Puck audio via FFmpeg...');
  const ffmpeg = spawn('ffmpeg', [
    '-y',
    '-framerate', '10',
    '-i', join(framesDir, '%05d.png'),
    '-i', paddedAudio,
    '-c:v', 'libx264',
    '-preset', 'slow',
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-shortest',
    '-movflags', '+faststart',
    join(root, 'results/demo_fluid.mp4')
  ], { stdio: 'inherit' });

  await new Promise((resolve, reject) => {
    ffmpeg.on('error', reject);
    ffmpeg.on('exit', code => code === 0 ? resolve() : reject(new Error('FFmpeg failed: ' + code)));
  });

  console.log('SUCCESS! Fluid video generated at results/demo_fluid.mp4');

} finally {
  socket?.close();
  if (browser.pid && browser.exitCode === null) {
    const exited = new Promise(r => browser.once('exit', r));
    browser.kill();
    await exited;
  }
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
  process.exit(0);
}

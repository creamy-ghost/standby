// Master broadcast-quality demo video capture for NEAR Hackathon.
// Produces 91.9s 1080p video synchronized with Gemini 3.8 Flash-Lite TTS (Puck voice).
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const framesDir = join(root, 'results/video-frames');
rmSync(framesDir, { recursive: true, force: true });
mkdirSync(framesDir, { recursive: true });

process.env.STANDBY_LAB_PORT = '4329';
console.log('Starting internal Failure Lab server on port 4329...');
await import('./lab-server.mjs');
await new Promise(r => setTimeout(r, 1500));

const origin = 'http://127.0.0.1:4329';
const profile = mkdtempSync(join(tmpdir(), 'standby-video-prof-'));

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

async function captureSingleFrame() {
  const t0 = Date.now();
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const filename = String(currentFrame++).padStart(5, '0') + '.png';
  writeFileSync(join(framesDir, filename), Buffer.from(shot.data, 'base64'));
  const elapsed = Date.now() - t0;
  const wait = Math.max(0, 100 - elapsed);
  if (wait > 0) await delay(wait);
}

async function captureFrames(count) {
  for (let i = 0; i < count; i++) {
    await captureSingleFrame();
  }
}

async function captureUntil(targetFrame) {
  while (currentFrame < targetFrame) {
    await captureSingleFrame();
  }
}

async function injectCaptionBar() {
  await evaluate(`(() => {
    if (document.getElementById('video-caption-bar')) return;
    const bar = document.createElement('div');
    bar.id = 'video-caption-bar';
    bar.style.cssText = 'position:fixed;bottom:36px;left:50%;transform:translateX(-50%);z-index:999999;background:rgba(8,16,13,0.92);border:1.5px solid rgba(194,245,131,0.55);box-shadow:0 16px 45px rgba(0,0,0,0.8),0 0 35px rgba(194,245,131,0.22);border-radius:9999px;padding:16px 36px;display:flex;align-items:center;gap:16px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#f3f4e9;font-size:23px;font-weight:600;letter-spacing:-0.01em;backdrop-filter:blur(20px);text-shadow:0 2px 4px rgba(0,0,0,0.5);transition:all 0.3s ease;';
    bar.innerHTML = '<span style=\"width:14px;height:14px;border-radius:50%;background:#c2f583;box-shadow:0 0 14px #c2f583;flex-shrink:0;animation:pulse 2s infinite ease-in-out;\"></span><span id=\"video-caption-text\"></span>';
    document.body.appendChild(bar);

    const style = document.createElement('style');
    style.textContent = \`
      @keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.55; transform: scale(0.85); } }
      .demo-highlight { outline: 3.5px solid #c2f583 !important; box-shadow: 0 0 40px rgba(194,245,131,0.55) !important; transition: all 0.35s ease !important; }
    \`;
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

async function waitForActionWhileCapturing(action, nextPhase, maxFrames = 80) {
  await evaluate(`document.querySelector('[data-action="${action}"]').click()`);
  await delay(100);
  const start = Date.now();
  let count = 0;
  while (count < maxFrames) {
    await captureSingleFrame();
    count++;
    const ready = await evaluate(`document.getElementById('progress').hidden && document.getElementById('phase-label').textContent === ${JSON.stringify(nextPhase)}`);
    if (ready) break;
    if (Date.now() - start > 60000) throw new Error('Timeout waiting for ' + action + ' -> ' + nextPhase);
  }
}

async function fastActionNoFrames(action, nextPhase) {
  await evaluate(`document.querySelector('[data-action="${action}"]').click()`);
  await delay(200);
  const start = Date.now();
  while (true) {
    const ready = await evaluate(`document.getElementById('progress').hidden && document.getElementById('phase-label').textContent === ${JSON.stringify(nextPhase)}`);
    if (ready) break;
    if (Date.now() - start > 60000) throw new Error('Timeout waiting for ' + action + ' -> ' + nextPhase);
    await delay(150);
  }
}

try {
  // =========================================================================
  // SCENE 1: Primary Stops; Deadline Passes (Frames 0 -> 120 / 0.0s -> 12.0s)
  // Audio: "In decentralized agent networks, workers can disappear without warning.
  //         But your deadline doesn't move. Starting over with a cold retry restarts
  //         the entire hiring process from scratch."
  // =========================================================================
  console.log('--- SCENE 1: Primary Stops; Deadline Passes (Target: Frame 120) ---');
  await send('Page.navigate', { url: origin });
  await delay(1200);
  await injectCaptionBar();
  await setCaption("Your worker disappears. The deadline doesn't.");
  await evaluate('window.scrollTo({ top: 0, behavior: "smooth" })');

  // Initial lab overview
  await captureFrames(25);

  // Click start: create job & get backup offer (captured in real time)
  console.log('Action: start job');
  await highlight('[data-action="start"]');
  await captureFrames(10);
  await waitForActionWhileCapturing('start', 'Primary active', 45);

  // Highlight primary worker and active clock
  await highlight('.participant.primary');
  await captureFrames(25);
  await highlight('#clock');

  // Fill up to target frame 120
  await captureUntil(120);

  // =========================================================================
  // SCENE 2: Purchase Backup; Highlight Escrow & Bond (Frames 120 -> 260 / 12.0s -> 26.0s)
  // Audio: "Standby lets buyers secure a bonded backup worker beforehand.
  //         The provider posts a 0.5 NEAR bond on-chain, committing to deliver
  //         at an agreed replacement price. Escrow securely holds the strike payment
  //         and provider bond."
  // =========================================================================
  console.log('--- SCENE 2: Purchase Backup; Escrow & Bond (Target: Frame 260) ---');
  await setCaption("Standby locks an agreed replacement price & 0.5 NEAR provider bond beforehand.");
  await highlight('[data-action="buy"]');
  await captureFrames(20);

  console.log('Action: buy backup');
  await waitForActionWhileCapturing('buy', 'Backup purchased', 45);

  // Highlight escrow ledger: strike payment + provider bond securely held
  await highlight('.escrow');
  await captureFrames(45);

  // Primary misses deadline
  console.log('Action: let primary miss deadline');
  await highlight('[data-action="fail_primary"]');
  await captureFrames(10);
  await waitForActionWhileCapturing('fail_primary', 'Primary failed', 30);
  await highlight('.participant.primary');

  // Fill up to target frame 260
  await captureUntil(260);

  // =========================================================================
  // SCENE 3: Activate -> Worker Delivers -> Verification -> Payment Credit (Frames 260 -> 430 / 26.0s -> 43.0s)
  // Audio: "When the primary misses its deadline, I activate the backup. Its worker
  //         immediately submits the solution prepared speculatively in the background.
  //         The NEAR contract verifies the answer on-chain, credits payment, and all
  //         funds become withdrawable—leaving zero outstanding obligations on the ledger."
  // =========================================================================
  console.log('--- SCENE 3: Activate -> Settle -> Withdraw (Target: Frame 430) ---');
  await setCaption("When primary misses deadline: activate standby → worker delivers solution.");
  await highlight('[data-action="activate"]');
  await captureFrames(15);

  console.log('Action: activate backup');
  await waitForActionWhileCapturing('activate', 'Backup active', 30);
  await highlight('[data-action="deliver"]');
  await captureFrames(15);

  console.log('Action: deliver answer');
  await waitForActionWhileCapturing('deliver', 'Settlement credited', 40);

  // Update caption for verification & inspection
  await setCaption("NEAR contract verifies answer on-chain → payment credited and withdrawn.");
  await highlight('.participant.backup');
  await captureFrames(20);

  console.log('Action: inspect verified solution');
  await evaluate(`document.querySelector('details.inspect').open = true`);
  await highlight('details.inspect');
  await captureFrames(30);

  console.log('Action: withdraw credited funds');
  await highlight('[data-action="withdraw"]');
  await captureFrames(10);
  await waitForActionWhileCapturing('withdraw', 'Funds withdrawn', 35);
  await highlight('.escrow');

  // Fill up to target frame 430
  await captureUntil(430);

  // =========================================================================
  // SCENE 4: Cold-Retry Comparison (Frames 430 -> 560 / 43.0s -> 56.0s)
  // Audio: "Compare this to ordinary cold retry. Retry only begins hiring after failure
  //         has already happened, compounding delays. Standby secured the worker and
  //         pre-computed the task while the clock was still ticking."
  // =========================================================================
  console.log('--- SCENE 4: Cold-Retry Comparison (Target: Frame 560) ---');
  await send('Page.navigate', { url: origin + '/evidence' });
  await delay(900);
  await injectCaptionBar();
  await setCaption("Cold retry hires after failure. Standby prepared while the clock was ticking.");
  await evaluate(`document.querySelector('section').scrollIntoView({ behavior: 'smooth', block: 'start' })`);
  await captureFrames(30);

  // Highlight Warm Standby card
  await highlight('article.card:nth-of-type(1)');
  await captureFrames(45);

  // Highlight Cold Retry card
  await highlight('article.card:nth-of-type(2)');
  await captureFrames(45);

  // Fill up to target frame 560
  await captureUntil(560);

  // =========================================================================
  // SCENE 5: Backup Also Fails -> Refund and Slashing (Frames 560 -> 700 / 56.0s -> 70.0s)
  // Audio: "Enforcement cuts both ways. If the activated backup fails to deliver,
  //         the contract slashes its bond and refunds the buyer in full—crediting
  //         3.1 NEAR back to the buyer wallet. Both sides face real financial consequences."
  // =========================================================================
  console.log('--- SCENE 5: Backup Slashing & Refund (Target: Frame 700) ---');
  await send('Page.navigate', { url: origin });
  await delay(900);
  await injectCaptionBar();
  await setCaption("If backup fails: contract slashes the bond and refunds 3.1 NEAR to buyer.");

  // Fast setup path: reset -> start -> buy -> fail_primary -> activate
  console.log('Action: fast-forward to Backup Active state');
  await fastActionNoFrames('reset', 'No job yet');
  await fastActionNoFrames('start', 'Primary active');
  await fastActionNoFrames('buy', 'Backup purchased');
  await fastActionNoFrames('fail_primary', 'Primary failed');
  await fastActionNoFrames('activate', 'Backup active');

  // Show Backup Active state with the fail_backup option
  await highlight('[data-action="fail_backup"]');
  await captureFrames(20);

  console.log('Action: trigger backup deadline miss (fail_backup)');
  await waitForActionWhileCapturing('fail_backup', 'Settlement credited', 45);

  // Highlight Buyer participant card showing 3.1 NEAR credit refund
  await highlight('.participant.buyer');
  await captureFrames(45);

  // Highlight confirmed activity log: bond slashed and buyer refunded
  await highlight('#activity');

  // Fill up to target frame 700
  await captureUntil(700);

  // =========================================================================
  // SCENE 6: Premium, Advance Funding & Calculator (Frames 700 -> 815 / 70.0s -> 81.5s)
  // Audio: "Standby requires advance capital and a premium. Our interactive
  //         calculator lets buyers evaluate when paying for standby is economically
  //         justified by the value of avoiding a missed deadline."
  // =========================================================================
  console.log('--- SCENE 6: Interactive Decision Calculator (Target: Frame 815) ---');
  await send('Page.navigate', { url: origin + '/evidence' });
  await delay(900);
  await injectCaptionBar();
  await setCaption("Interactive calculator: evaluate when deadline value covers the standby premium.");
  await evaluate(`document.querySelectorAll('section')[1].scrollIntoView({ behavior: 'smooth', block: 'center' })`);
  await captureFrames(25);

  // Smoothly adjust Failure probability to 25%
  console.log('Action: adjust failure probability to 25%');
  for (let val = 10; val <= 25; val += 3) {
    await evaluate(`{
      const el = document.getElementById('failure');
      el.value = ${val};
      el.dispatchEvent(new Event('input'));
    }`);
    await captureFrames(3);
  }

  // Adjust Deadline value to 20 NEAR
  console.log('Action: adjust deadline value to 20 NEAR');
  for (let val = 10; val <= 20; val += 2) {
    await evaluate(`{
      const el = document.getElementById('value');
      el.value = ${val};
      el.dispatchEvent(new Event('input'));
    }`);
    await captureFrames(3);
  }

  // Highlight net benefit
  await highlight('.big#benefit');
  await captureFrames(35);

  // Fill up to target frame 815
  await captureUntil(815);

  // =========================================================================
  // SCENE 7: Reproduction Link and Passing Checks (Frames 815 -> 919 / 81.5s -> 91.9s)
  // Audio: "All 44 scenario checks pass on the local NEAR sandbox with zero final
  //         obligations. Review our source code, test the interactive failure lab,
  //         and reproduce the results on GitHub."
  // =========================================================================
  console.log('--- SCENE 7: Full Verification & Reproduction (Target: Frame 919) ---');
  await send('Page.navigate', { url: origin + '/summary' });
  await delay(800);
  await injectCaptionBar();
  await setCaption("All 44 checks pass on local NEAR sandbox. Reproducible on GitHub.");
  await captureFrames(25);

  await highlight('.terminal-box');
  await captureFrames(35);

  await highlight('.reproduce-box');
  await captureUntil(919);

  console.log('TOTAL FRAMES CAPTURED:', currentFrame);

  console.log('Muxing broadcast-grade MP4 with Gemini 3.8 Puck narration...');
  const ffmpeg = spawn('ffmpeg', [
    '-y',
    '-framerate', '10',
    '-i', join(framesDir, '%05d.png'),
    '-i', join(root, 'results/audio/master_puck_full_expanded.wav'),
    '-c:v', 'libx264',
    '-preset', 'slow',
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-shortest',
    '-movflags', '+faststart',
    join(root, 'results/demo.mp4')
  ], { stdio: 'inherit' });

  await new Promise((resolve, reject) => {
    ffmpeg.on('error', reject);
    ffmpeg.on('exit', code => code === 0 ? resolve() : reject(new Error('FFmpeg failed: ' + code)));
  });

  console.log('SUCCESS! Broadcast video generated at results/demo.mp4');

} catch (err) {
  console.error('FATAL ERROR IN CAPTURE:', err);
  process.exitCode = 1;
} finally {
  socket?.close();
  if (browser.pid && browser.exitCode === null) {
    const exited = new Promise(r => browser.once('exit', r));
    browser.kill();
    await exited;
  }
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {}
  process.exit(0);
}

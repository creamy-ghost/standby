// Capture actual browser interactions with a successful source-run report.
// Requires Node 22+, Chromium and ffmpeg. Outputs remain under ignored results/.
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('..', import.meta.url));
const evidence = JSON.parse(readFileSync(join(root, 'results/validation-results.json')));
assert.ok(evidence.ok && evidence.artifact_mode === 'source build', 'A passing source replay is required');
assert.ok(evidence.comparison_inputs_identical, 'Comparison inputs must match');
const profile = mkdtempSync(join(tmpdir(), 'standby-video-'));
const frames = join(root, 'results/video-frames');
mkdirSync(frames, {recursive:true});
const browser = spawn(process.env.CHROMIUM_BIN || 'chromium', [
  '--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--user-data-dir='+profile, '--remote-debugging-port=0', 'about:blank',
], {stdio:['ignore','ignore','pipe']});
let socket;
try {
  const endpoint = await new Promise((resolve,reject) => {
    const timer=setTimeout(()=>reject(new Error('Chromium startup timeout')),20000);
    browser.on('error',error=>{clearTimeout(timer);reject(error);});
    browser.once('exit',code=>{clearTimeout(timer);reject(new Error('Chromium exited '+code));});
    browser.stderr.on('data', chunk => {
      const match=String(chunk).match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if(match){clearTimeout(timer);resolve(match[1]);}
    });
  });
  const tabs=await (await fetch(new URL('/json/list',endpoint.replace('ws:','http:')))).json();
  socket=new WebSocket(tabs[0].webSocketDebuggerUrl);
  await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}));
  const pending=new Map();let next=0;
  socket.onmessage=event=>{const msg=JSON.parse(event.data);if(msg.id){const p=pending.get(msg.id);pending.delete(msg.id);msg.error?p.reject(msg.error):p.resolve(msg.result);}};
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{
    const result=await send('Runtime.evaluate',{expression,returnByValue:true});
    if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:new URL('../results/report.html',import.meta.url).href});
  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  await delay(1000);
  assert.equal(await evaluate("JSON.parse(document.getElementById('evidence').textContent).wasm_sha256"),evidence.wasm_sha256);
  await evaluate(`{
    const caption=document.createElement('div');caption.id='video-caption';
    caption.style.cssText='position:fixed;bottom:20px;left:8%;right:8%;padding:18px 24px;background:#080e0bf5;color:#f3f4e9;border:1px solid #c2f583;border-radius:10px;font:22px/1.4 system-ui;z-index:9999;text-align:center';
    document.body.append(caption);
  }`);
  const scenes=[
    ['A primary worker misses its deadline. Standby buys a bonded replacement commitment on NEAR.', 'window.scrollTo(0,0)'],
    ['This is a completed source-built sandbox run. Timings are local observations; prices are fixture terms.', "document.querySelector('.stats').scrollIntoView()"],
    ['Standby pays a premium and holds more capital in advance. Cold retry hires after failure.', "document.querySelector('section').scrollIntoView()"],
    ['Change the assumptions. With no primary failures, the standby premium has no modeled benefit.', "document.querySelectorAll('section')[1].scrollIntoView();document.getElementById('failure').value=0;document.getElementById('failure').dispatchEvent(new Event('input'))"],
    ['Raise failure probability to 10%. Any modeled advantage still depends on assumed deadline value and reliability.', "document.getElementById('failure').value=10;document.getElementById('failure').dispatchEvent(new Event('input'))"],
    ['Inspect each contract check and final obligation total. Download the JSON and reproduce the run locally.', "document.querySelectorAll('section')[2].scrollIntoView();document.querySelector('details').open=true"],
  ];
  let frame=0;
  for(const [caption,action] of scenes){
    await evaluate(action);
    await evaluate('document.getElementById("video-caption").textContent='+JSON.stringify(caption));
    for(let i=0;i<24;i++){
      const shot=await send('Page.captureScreenshot',{format:'png'});
      writeFileSync(join(frames,String(frame++).padStart(5,'0')+'.png'),Buffer.from(shot.data,'base64'));
      await delay(250);
    }
  }
  const ffmpeg=spawn('ffmpeg',['-y','-loglevel','error','-framerate','4','-i',join(frames,'%05d.png'),'-frames:v',String(frame),'-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',join(root,'results/demo.mp4')],{stdio:'inherit'});
  await new Promise((resolve,reject)=>{ffmpeg.on('error',reject);ffmpeg.on('exit',code=>code===0?resolve():reject(new Error('ffmpeg exited '+code)));});
  console.log('Captured 36-second captioned evidence-viewer walkthrough: results/demo.mp4 (no audio)');
} finally {
  socket?.close();
  if(browser.pid && browser.exitCode === null){
    const exited=new Promise(resolve=>browser.once('exit',resolve));
    browser.kill();await exited;
  }
  rmSync(profile,{recursive:true,force:true});
}

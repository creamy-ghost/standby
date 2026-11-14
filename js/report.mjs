// Self-contained local evidence viewer. Reads fresh runner output; no network calls.
import { readFileSync, writeFileSync } from "node:fs";
const result = JSON.parse(readFileSync(new URL("../results/validation-results.json", import.meta.url)));
const data = JSON.stringify(result).replaceAll("<", "\\u003c");
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Standby · Recovery with a price</title>
<style>
:root{color-scheme:dark;--bg:#101816;--panel:#19241f;--line:#35463b;--ink:#f3f4e9;--muted:#b5c3b5;--green:#c2f583;--orange:#f2b880}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 system-ui,sans-serif}main{max-width:1120px;margin:auto;padding:36px 28px 72px}nav{display:flex;justify-content:space-between;border-bottom:1px solid var(--line);padding-bottom:22px}.brand{letter-spacing:.2em;font-weight:700}.tag,.eyebrow{color:var(--green);font:12px/1.5 ui-monospace,monospace;letter-spacing:.1em}h1{font-size:clamp(38px,6vw,72px);line-height:1.05;letter-spacing:-.055em;max-width:850px;margin:34px 0 22px}h2{font-size:28px;line-height:1.2;letter-spacing:-.035em}h3{margin:0 0 12px}p{max-width:740px;color:var(--muted)}.intro{font-size:20px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin:35px 0}.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:24px}.big{font-size:38px;letter-spacing:-.04em;font-weight:650;color:var(--green)}.label{color:var(--muted);font-size:14px}.row{display:flex;justify-content:space-between;gap:20px;border-bottom:1px solid var(--line);padding:12px 0}.row:last-child{border:0}.row span:last-child{font-variant-numeric:tabular-nums}section{margin-top:48px}.path{display:flex;flex-wrap:wrap;gap:8px;margin:20px 0}.path span{border:1px solid var(--line);padding:7px 11px;border-radius:6px;font-size:13px}.path span:last-child{color:var(--green)}.notice{border-left:3px solid var(--orange);padding-left:16px;color:var(--muted)}label{display:block;margin:14px 0 4px;color:var(--muted)}input{width:100%;accent-color:var(--green)}input[type=number]{background:var(--bg);color:var(--ink);border:1px solid var(--line);border-radius:6px;padding:9px;font:inherit}output{color:var(--ink);float:right}a{color:var(--green)}summary{cursor:pointer;padding:10px 0}li{margin:7px 0;color:var(--muted)}.pass{color:var(--green)}.fail{color:var(--orange)}code{overflow-wrap:anywhere;font-size:12px}footer{margin-top:48px;border-top:1px solid var(--line);padding-top:20px;color:var(--muted);font-size:13px}button{background:var(--green);border:0;border-radius:6px;color:var(--bg);padding:11px 18px;font:inherit;font-weight:650;cursor:pointer}button:focus-visible,a:focus-visible,summary:focus-visible{outline:3px solid var(--orange);outline-offset:4px}@media(max-width:650px){main{padding:24px 18px}.grid,.stats{grid-template-columns:1fr}nav{gap:12px}.card{padding:20px}.big{font-size:32px}}
</style>
<main><nav><span class="brand">STANDBY / NEAR</span><span class="tag">LOCAL SANDBOX EVIDENCE</span></nav>
<header><h1>A backup worker.<br>A price agreed before failure.</h1><p class="intro">Buy a bonded standby option, let the primary miss its deadline, then activate replacement delivery. Compare the result with hiring a cold retry worker.</p><p>NEAR holds the fees and bonds, verifies the answer, and credits the agreed settlement. This demo uses separate solver processes and a synthetic 10 × 10 integer system.</p></header>
<div class="stats"><div class="card"><div class="big" id="checks"></div><div class="label">scenario checks passed</div></div><div class="card"><div class="big" id="standbyTime"></div><div class="label">standby activation → delivery</div></div><div class="card"><div class="big" id="retryTime"></div><div class="label">retry hiring → delivery</div></div></div>
<p class="notice" id="context"></p>
<section><div class="eyebrow">01 / THE COMPLETE MOMENT</div><h2>The primary disappears. Settlement still has rules.</h2><div class="grid"><article class="card"><h3>Paid warm standby</h3><div class="path"><span>Primary failed</span><span>Activate option</span><span>Verified delivery</span></div><div class="row"><span>Replacement price</span><span id="standbyPrice"></span></div><div class="row"><span>Buyer capital before failure</span><span id="standbyCapital"></span></div><div class="row"><span>Provider bond</span><span id="standbyBond"></span></div><p>The standby worker solves speculatively before failure. The premium is paid even if the primary succeeds. A missed activated delivery deadline makes the bond slashable.</p></article><article class="card"><h3>Ordinary cold retry</h3><div class="path"><span>Primary failed</span><span>Create + accept</span><span>Solve + deliver</span></div><div class="row"><span>Replacement price</span><span id="retryPrice"></span></div><div class="row"><span>Buyer capital before failure</span><span id="retryCapital"></span></div><div class="row"><span>Provider bond</span><span id="retryBond"></span></div><p>The retry worker starts after failure. The baseline uses the same verifier and bonded escrow discipline. No standby premium or advance strike funding is needed.</p></article></div></section>
<section><div class="eyebrow">02 / THE BUYER DECISION</div><h2>When is the premium worth paying?</h2><p>Illustrative decision model: a buyer values avoiding a missed deadline. Change the assumptions to see when the expected benefit covers the premium. These probabilities are assumptions, not estimates from this run.</p><div class="grid"><div class="card"><label for="failure">Primary failure probability <output id="failureOut"></output></label><input id="failure" type="range" min="0" max="100" value="10"><label for="retryMiss">Retry misses deadline, given primary failure <output id="retryMissOut"></output></label><input id="retryMiss" type="range" min="0" max="100" value="30"><label for="standbyMiss">Standby misses deadline, given primary failure <output id="standbyMissOut"></output></label><input id="standbyMiss" type="range" min="0" max="100" value="10"><label for="value">Value of meeting the deadline (NEAR)</label><input id="value" type="number" min="0" max="1000000" step="0.1" value="10"></div><div class="card"><div class="label">Expected incremental value per job</div><div class="big" id="benefit" aria-live="polite"></div><p id="decision"></p><p>Primary failure probability × reduction in conditional deadline misses × deadline value − premium.</p><p class="notice">Assumes equal strike and retry fees. Excludes gas, extra capital opportunity cost, provider costs, bond transfers and correlated failures. Neither physical capacity reservation nor market demand is established.</p></div></div></section>
<section><div class="eyebrow">03 / INSPECT THE PROOF</div><h2>Reproduce the outcome. Inspect the limits.</h2><div class="card"><div class="row"><span>Artifact</span><span id="mode"></span></div><div class="row"><span>Final outstanding obligations</span><span id="obligations"></span></div><p>WASM SHA-256<br><code id="hash"></code></p><details><summary>Scenario checks</summary><ul id="results"></ul></details><details><summary>Job outcomes</summary><ul id="jobs"></ul></details><button id="download">Download run evidence</button></div><p class="notice">Single fixed-order local run. Recovery timers start at replacement activation or hiring, after primary failure is settled; they exclude failure detection and the failure-settlement call. Most time is sandbox transaction latency. Prices are fixture terms; gas and storage funding are excluded. The contract is prefunded with 100 local NEAR. This is a prototype, not a production security or solvency audit.</p></section>
<footer>Built for NEAR HACKATHON · No wallet, external API or funded account needed to replay locally. <span id="date"></span></footer></main>
<script type="application/json" id="evidence">${data}</script><script>
const d=JSON.parse(document.getElementById('evidence').textContent);
const el=id=>document.getElementById(id);
const text=(id,value)=>el(id).textContent=value;
const near=x=>(Number(BigInt(x))/1e24).toFixed(2)+' NEAR';
const c=d.comparison;
text('checks',d.results.filter(r=>r.ok).length+'/'+d.results.length);
text('standbyTime',(c.standby_B.recovery_wall_ms/1000).toFixed(2)+' s');
text('retryTime',(c.retry_G.recovery_wall_ms/1000).toFixed(2)+' s');
text('context',(d.comparison_inputs_identical?'Identical standby/retry input. ':'Historical run: different inputs. ')+c.verdict);
for(const [prefix,key] of [['standby','standby_B'],['retry','retry_G']]){
  text(prefix+'Price',near(c[key].replacement_price_yocto));
  text(prefix+'Capital',near(c[key].buyer_capital_held_before_failure_yocto));
  text(prefix+'Bond',near(c[key].provider_bond_yocto));
}
text('mode',d.artifact_mode||'Historical supplied WASM');
text('hash',d.wasm_sha256);
text('obligations',d.final_obligations_yocto===undefined?'Not captured':near(d.final_obligations_yocto));
text('date',d.generated_at||'Historical capture');
for(const r of d.results){
  const li=document.createElement('li');li.className=r.ok?'pass':'fail';
  li.textContent=(r.ok?'PASS · ':'FAIL · ')+r.name;el('results').append(li);
}
for(const [key,j] of Object.entries(d.jobs||{})){
  const li=document.createElement('li');li.textContent=key+' · '+j.job_ref+' → '+j.status;el('jobs').append(li);
}
const premium=Number(BigInt(c.standby_B.replacement_price_yocto)-BigInt(c.retry_G.replacement_price_yocto))/1e24;
function update(){
  for(const id of ['failure','retryMiss','standbyMiss'])text(id+'Out',el(id).value+'%');
  const value=Number(el('value').value);
  if(!Number.isFinite(value)||value<0){text('benefit','Enter a valid value');return;}
  const gain=el('failure').value/100*(el('retryMiss').value-el('standbyMiss').value)/100*value-premium;
  text('benefit',(gain>=0?'+':'')+gain.toFixed(3)+' NEAR');
  text('decision',gain>0?'These assumptions favor buying standby before omitted costs.':'These assumptions favor ordinary retry or primary-only execution.');
}
for(const input of document.querySelectorAll('input'))input.addEventListener('input',update);
update();
el('download').onclick=()=>{
  const url=URL.createObjectURL(new Blob([JSON.stringify(d,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download='standby-run-evidence.json';a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
};
</script></html>`;
writeFileSync(new URL('../results/report.html', import.meta.url), html);
console.log('Evidence viewer: results/report.html');

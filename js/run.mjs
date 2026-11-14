// Standby validation runner — local NEAR sandbox only.
// Useful task: solve integer linear system A x = b. Buyer publishes A,b but does
// NOT precompute x. Workers solve independently. Contract verifies A*x == b.
// Compares paid warm standby vs ordinary cold retry on the same task/evaluator.
import pkg from 'near-workspaces';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { performance } from 'node:perf_hooks';
const { Worker, parseNEAR } = pkg;

const wasm = process.env.STANDBY_WASM;
if (!wasm) throw new Error('Use ../run.sh to select and verify the WASM artifact');
const legacyFixture = process.env.STANDBY_FIXTURE === '1';
const N = (s) => BigInt(parseNEAR(s));
const results = [];
const timings = {};
function record(name, ok, detail = '') { results.push({ name, ok, detail: String(detail).slice(0, 500) }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ': ' + String(detail).slice(0, 250) : ''}`); }
async function expectFail(p, needle, name) {
  try { await p; record(name, false, 'expected failure but call succeeded'); }
  catch (e) { const msg = String(e.message || e); record(name, msg.includes(needle), msg.includes(needle) ? needle : msg.slice(0, 300)); }
}
const sha = (s) => createHash('sha256').update(s).digest('hex');

// --- Linear system generation (buyer does NOT solve) ---
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
function generateSystem(n, seed) {
  const r = mulberry32(seed); const ri = (lo,hi) => lo + Math.floor(r()*(hi-lo+1));
  const L = Array.from({length:n},()=>Array(n).fill(0));
  const U = Array.from({length:n},()=>Array(n).fill(0));
  for (let i=0;i<n;i++){L[i][i]=1;U[i][i]=1;for(let j=0;j<i;j++)L[i][j]=ri(-2,2);for(let j=i+1;j<n;j++)U[i][j]=ri(-2,2);}
  const A = Array.from({length:n},()=>Array(n).fill(0));
  for(let i=0;i<n;i++)for(let j=0;j<n;j++){let s=0;for(let k=0;k<n;k++)s+=L[i][k]*U[k][j];A[i][j]=s;}
  const b = Array.from({length:n},()=>ri(-50,50));
  return { n, a: A.flat(), b };
}

// --- Worker process helpers ---
function coldSolve(inputPath) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const proc = spawn(process.execPath, ['../workers/solve.mjs', inputPath], { cwd: import.meta.dirname });
    let out = '';
    proc.on('error', reject);
    proc.stdout.on('data', d => out += d);
    proc.stderr.on('data', d => process.stderr.write(d));
    proc.on('close', code => {
      const wall = performance.now() - t0;
      try { const j = JSON.parse(out.trim()); if (code !== 0 || !j.ok) throw new Error(j.error || `worker exited ${code}`); resolve({ ...j, wall_ms: wall }); }
      catch(e) { reject(new Error(`worker failed: ${e.message}: ${out}`)); }
    });
  });
}
function warmStandby(inputPath) {
  const proc = spawn(process.execPath, ['../workers/standby.mjs', inputPath], { cwd: import.meta.dirname });
  const rl = createInterface({ input: proc.stdout });
  let readyResolve, solutionResolve;
  const readyPromise = new Promise(r => readyResolve = r);
  let solutionPromise = new Promise(r => solutionResolve = r);
  rl.on('line', line => {
    const j = JSON.parse(line);
    if (j.type === 'ready') readyResolve(j);
    if (j.type === 'solution') solutionResolve(j);
    if (j.type === 'error') readyResolve(j);
  });
  return {
    ready: readyPromise,
    deliver() { proc.stdin.write('deliver\n'); return solutionPromise; },
    kill() { proc.stdin.write('kill\n'); proc.kill(); },
    proc,
  };
}

// --- Setup ---
mkdirSync('../results/inputs', { recursive: true });
const worker = await Worker.init({ network: 'sandbox', rm: true });
const warmWorkers = [];
try {
const root = worker.rootAccount;
const protocolConfig = await worker.provider.sendJsonRpc('EXPERIMENTAL_protocol_config', { finality: 'final' });
const storageAmountPerByte = BigInt(protocolConfig.runtime_config.storage_amount_per_byte);
const contract = await root.devDeploy(wasm, { method: 'new', args: {}, initialBalance: parseNEAR('100') });
const buyer = await root.createSubAccount('buyer', { initialBalance: parseNEAR('50') });
const primary = await root.createSubAccount('primary', { initialBalance: parseNEAR('50') });
const standby = await root.createSubAccount('standby', { initialBalance: parseNEAR('50') });
const retryWorker = await root.createSubAccount('retry', { initialBalance: parseNEAR('50') });
const attacker = await root.createSubAccount('attacker', { initialBalance: parseNEAR('50') });

async function nowMs() { const b = await worker.provider.sendJsonRpc('block', { finality: 'final' }); return Number(BigInt(b.header.timestamp) / 1000000n); }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function advanceTo(target) {
  // fastForward takes blocks, not seconds. Re-read the chain timestamp after
  // small batches so a longer setup cannot overshoot the option window.
  for (let i = 0; i < 1000; i++) {
    const now = await nowMs();
    if (now >= target) return now;
    await worker.provider.fastForward(1);
    // The RPC acknowledges the request before the final head reflects it.
    // Wait for time to advance before requesting another skipped block.
    let advanced = false;
    for (let poll = 0; poll < 200; poll++) {
      await delay(100);
      if ((await nowMs()) > now) { advanced = true; break; }
    }
    if (!advanced) throw new Error('sandbox clock stalled after fast-forward');
  }
  throw new Error(`sandbox time did not reach ${target}`);
}

const PRIMARY_FEE = N('1'), PRIMARY_BOND = N('0.5'), PREMIUM = N('0.1'), STRIKE = N('1'), STANDBY_BOND = N('0.5');
const RETRY_FEE = N('1'), RETRY_BOND = N('0.5');
const expectedCredits = { [buyer.accountId]: 0n, [primary.accountId]: 0n, [standby.accountId]: 0n, [retryWorker.accountId]: 0n, [attacker.accountId]: 0n };
function addCredit(acct, amount) { expectedCredits[acct.accountId] += amount; }
async function creditOf(acct) { return BigInt(await contract.view('credit_of', { account: acct.accountId })); }
async function accounting(label) {
  const jobCount = Number(await contract.view('job_count'));
  const offerCount = Number(await contract.view('offer_count'));
  let primaryHeld = 0n, offerHeld = 0n, retryHeld = 0n;
  for (let id = 1; id <= jobCount; id++) { primaryHeld += BigInt(await contract.view('primary_held', { job_id: id })); retryHeld += BigInt(await contract.view('retry_held', { job_id: id })); }
  for (let id = 1; id <= offerCount; id++) offerHeld += BigInt(await contract.view('offer_held', { offer_id: id }));
  const credits = BigInt(await contract.view('credits_total'));
  const obligations = BigInt(await contract.view('obligations'));
  assert.equal(obligations, primaryHeld + offerHeld + retryHeld + credits, `${label}: obligations mismatch`);
  const acct = await worker.provider.sendJsonRpc('query', { request_type: 'view_account', finality: 'final', account_id: contract.accountId });
  const amount = BigInt(acct.amount), locked = BigInt(acct.locked), storageUsage = BigInt(acct.storage_usage || 0);
  const storageStake = storageUsage * storageAmountPerByte;
  assert.ok(amount >= obligations + storageStake, `${label}: balance ${amount}+${locked} < obligations ${obligations} + storage ${storageStake}`);
  for (const a of [buyer, primary, standby, retryWorker, attacker]) assert.equal(await creditOf(a), expectedCredits[a.accountId], `${label}: credit mismatch ${a.accountId}`);
  record(`accounting ${label}`, true, `obligations=${obligations} primary=${primaryHeld} offers=${offerHeld} retry=${retryHeld} credits=${credits} storage=${storageUsage}B`);
}

// Deadlines
const base = await nowMs();
const PRIMARY_DEADLINE = base + 120000, ACTIVATE_AFTER = base + 125000, OPTION_EXPIRY = base + 180000, DELIVERY_DEADLINE = base + 240000;

// Generate 6 jobs: A=primary success, B=standby success, C=standby fail, D=unsold, E=unaccepted+standby, F=unaccepted+retry
const jobKeys = ['A','B','C','D','E','F','G','H'];
// G = ordinary retry success (primary accepted then disappears)
// H = ordinary retry failure (primary accepted then disappears, retry never delivers)
const inputs = {}, jobs = {}, offers = {};
for (const k of jobKeys) {
  const sys = generateSystem(10, 100 + (k === 'G' ? 'B' : k).charCodeAt(0));
  inputs[k] = { job_ref: `validation-job-${k}`, ...sys, input_hash: '' };
  inputs[k].input_hash = sha(JSON.stringify({ n: sys.n, a: sys.a, b: sys.b }));
  writeFileSync(`../results/inputs/job-${k}.json`, JSON.stringify(inputs[k], null, 2));
}

// Create jobs
for (const k of jobKeys) {
  const inp = inputs[k];
  jobs[k] = Number(await buyer.call(contract, 'create_job', {
    job_ref: inp.job_ref, n: inp.n, a: inp.a, b: inp.b, input_hash: inp.input_hash,
    primary: primary.accountId, primary_fee: PRIMARY_FEE.toString(), primary_deadline_ms: PRIMARY_DEADLINE,
  }, { attachedDeposit: PRIMARY_FEE.toString(), gas: '300000000000000' }));
}
// Accept primaries for A,B,C,D,G (not E,F — unaccepted)
for (const k of ['A','B','C','D','G','H']) {
  await primary.call(contract, 'accept_primary', { job_id: jobs[k] }, { attachedDeposit: PRIMARY_BOND.toString() });
}
// Create standby offers for A,B,C,D,E (not F,G)
for (const k of ['A','B','C','D','E']) {
  offers[k] = Number(await standby.call(contract, 'create_standby_offer', {
    job_id: jobs[k], resource_id: `local-cpu-${k}`, premium: PREMIUM.toString(), strike: STRIKE.toString(),
    activate_after_ms: ACTIVATE_AFTER, option_expiry_ms: OPTION_EXPIRY, delivery_deadline_ms: DELIVERY_DEADLINE,
  }, { attachedDeposit: STANDBY_BOND.toString(), gas: '300000000000000' }));
}
// Competing offers can be posted before selection. Only one may be purchased.
let competingOffer;
if (!legacyFixture) {
  competingOffer = Number(await standby.call(contract, 'create_standby_offer', {
    job_id: jobs.B, resource_id: 'competing-B', premium: PREMIUM.toString(), strike: STRIKE.toString(),
    activate_after_ms: ACTIVATE_AFTER, option_expiry_ms: OPTION_EXPIRY, delivery_deadline_ms: DELIVERY_DEADLINE,
  }, { attachedDeposit: STANDBY_BOND.toString() }));
}
// Buy options for A,B,C,E (D stays unsold)
for (const k of ['A','B','C','E']) {
  await buyer.call(contract, 'buy_standby_option', { offer_id: offers[k] }, { attachedDeposit: (PREMIUM + STRIKE).toString() });
}
if (!legacyFixture) {
  await expectFail(buyer.call(contract, 'buy_standby_option', { offer_id: competingOffer }, {
    attachedDeposit: (PREMIUM + STRIKE).toString(),
  }), 'standby already exists', 'second purchased standby rejected');
  record('selected standby preserved', (await contract.view('get_job', { job_id: jobs.B })).standby_offer_id === offers.B);
}
await accounting('after funding');

// --- Warm standby workers for B and E (pre-solve while reserved) ---
const warmB = warmStandby(`../results/inputs/job-B.json`);
const warmE = warmStandby(`../results/inputs/job-E.json`);
warmWorkers.push(warmB, warmE);
const readyB = await warmB.ready;
const readyE = await warmE.ready;
assert.equal(readyB.type, 'ready', readyB.error);
assert.equal(readyE.type, 'ready', readyE.error);
record('warm standby B ready', readyB.solve_ms !== undefined, `solve_ms=${readyB.solve_ms?.toFixed(1)}`);
record('warm standby E ready', readyE.solve_ms !== undefined, `solve_ms=${readyE.solve_ms?.toFixed(1)}`);
timings.warm_standby_B_solve_ms = readyB.solve_ms;
timings.warm_standby_E_solve_ms = readyE.solve_ms;

// --- 1) Primary A completes normally ---
const t0A = performance.now();
const solA = await coldSolve(`../results/inputs/job-A.json`);
assert.ok(solA.ok, 'primary A worker failed');
await primary.call(contract, 'complete_primary', { job_id: jobs.A, solution: solA.solution });
addCredit(primary, PRIMARY_FEE + PRIMARY_BOND);
timings.primary_A_wall_ms = performance.now() - t0A;
timings.primary_A_worker_ms = solA.wall_ms;
const jobA = await contract.view('get_job', { job_id: jobs.A });
record('primary completes useful task', jobA.status === 'Completed' && jobA.solution !== null);
// Verify solution independently
const checkA = inputs.A.a.reduce((acc, v, idx) => { const row = Math.floor(idx / inputs.A.n); acc[row] = (acc[row] || 0) + v * solA.solution[idx % inputs.A.n]; return acc; }, []);
record('primary A solution verified off-chain', checkA.every((v, i) => v === inputs.A.b[i]));
await accounting('after primary A complete');

// --- Negative: wrong solution, cross-job, wrong caller ---
await expectFail(primary.call(contract, 'complete_primary', { job_id: jobs.B, solution: Array(10).fill(0) }), 'solution does not satisfy job', 'zero solution rejected');
await expectFail(primary.call(contract, 'complete_primary', { job_id: jobs.B, solution: solA.solution }), 'solution does not satisfy job', 'cross-job solution rejected');
await expectFail(attacker.call(contract, 'complete_primary', { job_id: jobs.B, solution: solA.solution }), 'only primary', 'wrong caller rejected');

// --- 2) Advance past primary deadline; fail accepted primaries, expire unaccepted ---
await advanceTo(PRIMARY_DEADLINE + 1000);
for (const k of ['B','C','D','G','H']) { await buyer.call(contract, 'fail_primary', { job_id: jobs[k] }); addCredit(buyer, PRIMARY_FEE + PRIMARY_BOND); }
for (const k of ['E','F']) { await buyer.call(contract, 'expire_unaccepted_primary', { job_id: jobs[k] }); addCredit(buyer, PRIMARY_FEE); }
record('accepted primary failure refunds buyer', (await contract.view('get_job', { job_id: jobs.B })).status === 'PrimaryFailed');
record('unaccepted primary expiry refunds buyer', (await contract.view('get_job', { job_id: jobs.E })).status === 'PrimaryFailed');
// Late acceptance rejected
await expectFail(primary.call(contract, 'accept_primary', { job_id: jobs.E }, { attachedDeposit: PRIMARY_BOND.toString() }), 'not created', 'late acceptance after unaccepted expiry rejected');
// Repeat expiry rejected
await expectFail(buyer.call(contract, 'expire_unaccepted_primary', { job_id: jobs.E }), 'not created', 'repeated unaccepted expiry rejected');
await accounting('after primary failures');

// --- 3) Activate standby B, C, E ---
await advanceTo(ACTIVATE_AFTER + 1000);
const t0B = performance.now();
await buyer.call(contract, 'activate_standby', { offer_id: offers.B });

// --- 4) Standby B delivers (warm, pre-solved) ---
const solB = await warmB.deliver();
await standby.call(contract, 'complete_standby', { offer_id: offers.B, solution: solB.solution });
addCredit(standby, PREMIUM + STRIKE + STANDBY_BOND);
timings.standby_B_recovery_wall_ms = performance.now() - t0B;
await expectFail(buyer.call(contract, 'activate_standby', { offer_id: offers.B }), 'not optioned', 'repeated activation rejected');
await expectFail(buyer.call(contract, 'activate_standby', { offer_id: offers.D }), 'not optioned', 'unpurchased offer cannot activate');
timings.standby_B_wait_ms = solB.wait_ms;
const jobB = await contract.view('get_job', { job_id: jobs.B });
record('standby delivers useful task after primary disappears', jobB.status === 'Completed' && jobB.solution !== null);
await expectFail(standby.call(contract, 'complete_standby', { offer_id: offers.B, solution: solB.solution }), 'not activated', 'repeated standby delivery rejected');
await accounting('after standby B complete');

// --- 5) Standby E delivers (unaccepted primary path) ---
const t0E = performance.now();
await buyer.call(contract, 'activate_standby', { offer_id: offers.E });
const solE = await warmE.deliver();
await standby.call(contract, 'complete_standby', { offer_id: offers.E, solution: solE.solution });
addCredit(standby, PREMIUM + STRIKE + STANDBY_BOND);
timings.standby_E_recovery_wall_ms = performance.now() - t0E;
const jobE = await contract.view('get_job', { job_id: jobs.E });
record('unaccepted primary -> standby delivers', jobE.status === 'Completed' && jobE.solution !== null);
await accounting('after standby E complete');

// Activate C for later failure path
await buyer.call(contract, 'activate_standby', { offer_id: offers.C });

// --- 6) Ordinary retry G (cold worker, same task/evaluator) ---
const t0G = performance.now();
await buyer.call(contract, 'create_retry', { job_id: jobs.G, worker: retryWorker.accountId, fee: RETRY_FEE.toString(), deadline_ms: DELIVERY_DEADLINE }, { attachedDeposit: RETRY_FEE.toString() });
await retryWorker.call(contract, 'accept_retry', { job_id: jobs.G }, { attachedDeposit: RETRY_BOND.toString() });
const solG = await coldSolve(`../results/inputs/job-G.json`);
assert.ok(solG.ok, 'retry worker failed');
await retryWorker.call(contract, 'complete_retry', { job_id: jobs.G, solution: solG.solution });
addCredit(retryWorker, RETRY_FEE + RETRY_BOND);
timings.retry_G_recovery_wall_ms = performance.now() - t0G;
timings.retry_G_worker_ms = solG.wall_ms;
const jobG = await contract.view('get_job', { job_id: jobs.G });
record('ordinary retry delivers useful task', jobG.status === 'Completed' && jobG.solution !== null);
await expectFail(retryWorker.call(contract, 'complete_retry', { job_id: jobs.G, solution: solG.solution }), 'not retry active', 'repeated retry delivery rejected');
await accounting('after retry G complete');

// --- 7) Ordinary retry F (unaccepted primary path) ---
const t0F = performance.now();
await buyer.call(contract, 'create_retry', { job_id: jobs.F, worker: retryWorker.accountId, fee: RETRY_FEE.toString(), deadline_ms: DELIVERY_DEADLINE }, { attachedDeposit: RETRY_FEE.toString() });
await retryWorker.call(contract, 'accept_retry', { job_id: jobs.F }, { attachedDeposit: RETRY_BOND.toString() });
const solF = await coldSolve(`../results/inputs/job-F.json`);
assert.ok(solF.ok, 'retry F worker failed');
await retryWorker.call(contract, 'complete_retry', { job_id: jobs.F, solution: solF.solution });
addCredit(retryWorker, RETRY_FEE + RETRY_BOND);
timings.retry_F_recovery_wall_ms = performance.now() - t0F;
const jobF = await contract.view('get_job', { job_id: jobs.F });
record('unaccepted primary -> ordinary retry delivers', jobF.status === 'Completed' && jobF.solution !== null);
await accounting('after retry F complete');

// --- 7b) Ordinary retry H is accepted but never delivers ---
await buyer.call(contract, 'create_retry', { job_id: jobs.H, worker: retryWorker.accountId, fee: RETRY_FEE.toString(), deadline_ms: DELIVERY_DEADLINE }, { attachedDeposit: RETRY_FEE.toString() });
await retryWorker.call(contract, 'accept_retry', { job_id: jobs.H }, { attachedDeposit: RETRY_BOND.toString() });
await accounting('after retry H accepted');

// --- 8) Standby C fails (kill warm worker, never deliver) ---
warmB.kill(); warmE.kill();
// C has no warm worker; just let deadline pass
await advanceTo(OPTION_EXPIRY + 1000);
// Expire unused option A
await buyer.call(contract, 'expire_standby', { offer_id: offers.A });
addCredit(standby, PREMIUM + STANDBY_BOND); addCredit(buyer, STRIKE);
await expectFail(buyer.call(contract, 'expire_standby', { offer_id: offers.A }), 'not optioned', 'repeated expiry rejected');
// Reclaim unsold D
await expectFail(buyer.call(contract, 'buy_standby_option', { offer_id: offers.D }, { attachedDeposit: (PREMIUM + STRIKE).toString() }), 'option expired', 'expired unpurchased offer cannot be bought');
await standby.call(contract, 'reclaim_unsold_offer', { offer_id: offers.D });
addCredit(standby, STANDBY_BOND);
record('unpurchased offer bond released', (await contract.view('get_offer', { offer_id: offers.D })).status === 'Reclaimed');
await expectFail(standby.call(contract, 'reclaim_unsold_offer', { offer_id: offers.D }), 'not offered', 'repeated reclaim rejected');
if (!legacyFixture) {
  await standby.call(contract, 'reclaim_unsold_offer', { offer_id: competingOffer });
  addCredit(standby, STANDBY_BOND);
  record('unselected competing offer reclaimed', (await contract.view('get_offer', { offer_id: competingOffer })).status === 'Reclaimed');
}
await accounting('after expiry and reclaim');

// --- 9) Slash standby C ---
await advanceTo(DELIVERY_DEADLINE + 1000);
await buyer.call(contract, 'slash_standby', { offer_id: offers.C });
addCredit(buyer, PREMIUM + STRIKE + STANDBY_BOND);
const jobC = await contract.view('get_job', { job_id: jobs.C });
record('standby failure slashes and refunds buyer', jobC.status === 'Failed' && (await contract.view('get_offer', { offer_id: offers.C })).status === 'Slashed');
await expectFail(buyer.call(contract, 'slash_standby', { offer_id: offers.C }), 'not activated', 'repeated slash rejected');
await buyer.call(contract, 'fail_retry', { job_id: jobs.H });
addCredit(buyer, RETRY_FEE + RETRY_BOND);
record('retry failure refunds buyer', (await contract.view('get_job', { job_id: jobs.H })).status === 'Failed');
await expectFail(buyer.call(contract, 'fail_retry', { job_id: jobs.H }), 'retry not live', 'repeated retry failure rejected');
await accounting('after standby C slash and retry H failure');

// --- 10) Withdrawals ---
await expectFail(buyer.call(contract, 'withdraw', { amount: (expectedCredits[buyer.accountId] + 1n).toString() }), 'insufficient credit', 'over-withdrawal rejected');
for (const a of [buyer, primary, standby, retryWorker]) {
  const amount = expectedCredits[a.accountId];
  if (amount > 0n) { await a.call(contract, 'withdraw', { amount: amount.toString() }); expectedCredits[a.accountId] = 0n; }
}
await accounting('after withdrawals');
record('all credits withdrawn', (await contract.view('credits_total')) === '0');
record('no live obligations remain', (await contract.view('obligations')) === '0');

// --- Comparison summary ---
const comparison = {
  task: 'solve 10x10 integer linear system A x = b; contract verifies A*x == b exactly',
  buyer_does_not_precompute: true,
  standby_B: {
    recovery_wall_ms: timings.standby_B_recovery_wall_ms,
    worker_presolve_ms: timings.warm_standby_B_solve_ms,
    replacement_price_yocto: (PREMIUM + STRIKE).toString(),
    net_buyer_cost_after_primary_refund_yocto: (PREMIUM + STRIKE - PRIMARY_BOND).toString(),
    buyer_capital_held_before_failure_yocto: (PRIMARY_FEE + PREMIUM + STRIKE).toString(),
    provider_bond_yocto: STANDBY_BOND.toString(),
    note: 'warm standby pre-solved during reservation; recovery window is activation + delivery',
  },
  retry_G: {
    recovery_wall_ms: timings.retry_G_recovery_wall_ms,
    worker_cold_solve_ms: timings.retry_G_worker_ms,
    replacement_price_yocto: RETRY_FEE.toString(),
    net_buyer_cost_after_primary_refund_yocto: (RETRY_FEE - PRIMARY_BOND).toString(),
    buyer_capital_held_before_failure_yocto: PRIMARY_FEE.toString(),
    provider_bond_yocto: RETRY_BOND.toString(),
    note: 'cold retry solves after failure; recovery window is create + accept + solve + delivery',
  },
  primary_A: {
    wall_ms: timings.primary_A_wall_ms,
    buyer_cost_yocto: (PRIMARY_FEE + PREMIUM).toString(),
    note: 'primary A succeeds; its purchased standby option expires and the provider keeps the premium',
  },
  verdict: timings.standby_B_recovery_wall_ms < timings.retry_G_recovery_wall_ms
    ? 'In this local run, warm standby recovered faster than cold retry, but the task is tiny and sandbox transaction latency dominates. Standby still costs a non-refundable premium when the primary succeeds, locks more buyer capital before failure, and a failed standby leaves the job without output. Single fixed-order run with identical B/G inputs; fixture prices exclude gas, storage funding and provider operating costs. No general economic superiority is established.'
    : 'In this local run, ordinary cold retry recovered as fast or faster than warm standby and was cheaper. The task is tiny and sandbox transaction latency dominates. Standby costs a non-refundable premium when the primary succeeds, locks more buyer capital before failure, and a failed standby leaves the job without output. Single fixed-order run with identical B/G inputs; fixture prices exclude gas, storage funding and provider operating costs. No general economic superiority is established.',
};

const ok = results.every(r => r.ok);
const wasmBytes = readFileSync(wasm);
writeFileSync('../results/validation-results.json', JSON.stringify({
  ok,
  generated_at: new Date().toISOString(),
  artifact_mode: legacyFixture ? 'supplied historical WASM' : 'source build',
  comparison_inputs_identical: JSON.stringify(inputs.B.a) === JSON.stringify(inputs.G.a) && JSON.stringify(inputs.B.b) === JSON.stringify(inputs.G.b),
  task: comparison.task,
  wasm_sha256: createHash('sha256').update(wasmBytes).digest('hex'),
  sandbox: 'neard 2.14.0 (protocol 88), local only',
  node: process.version,
  timings,
  comparison,
  jobs: Object.fromEntries(await Promise.all(jobKeys.map(async k => [k, await contract.view('get_job', { job_id: jobs[k] })]))),
  final_obligations_yocto: await contract.view('obligations'),
  results,
}, null, 2));
console.log('\n--- COMPARISON ---');
console.log(JSON.stringify(comparison, null, 2));
console.log(ok ? '\nALL CHECKS PASSED' : '\nSOME CHECKS FAILED');
process.exitCode = ok ? 0 : 1;
} catch (error) {
  writeFileSync('../results/failure.json', JSON.stringify({
    ok: false, generated_at: new Date().toISOString(),
    artifact_mode: legacyFixture ? 'supplied historical WASM' : 'source build',
    wasm_sha256: sha(readFileSync(wasm)), results, error: String(error),
  }, null, 2));
  console.error(error);
  process.exitCode = 1;
} finally {
  for (const w of warmWorkers) w.proc.kill();
  await worker.tearDown();
}

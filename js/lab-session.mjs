// Real contract transitions for the local browser lab. Never accepts RPC URLs,
// keys, arbitrary methods or amounts from the browser.
import pkg from 'near-workspaces';
import assert from 'node:assert/strict';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { join } from 'node:path';

const { Worker, parseNEAR } = pkg;
const root = fileURLToPath(new URL('..', import.meta.url));
const wasm = join(root, 'contract/target/source/wasm32-unknown-unknown/release/standby_validation.wasm');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sessionHash = sha(readFileSync(fileURLToPath(import.meta.url)));
const N = amount => parseNEAR(amount).toString();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const TERMS = { primary_fee: N('1'), primary_bond: N('0.5'), premium: N('0.1'), strike: N('1'), backup_bond: N('0.5') };
const allowed = {
  idle: ['start'], quoted: ['buy', 'reset'], optioned: ['fail_primary', 'reset'],
  primary_failed: ['activate', 'reset'], active: ['deliver', 'fail_backup', 'invalid', 'reset'],
  settled: ['withdraw', 'reset'], withdrawn: ['reset'], error: ['reset'],
};

// Unit triangular matrices make the random integer RHS exactly solvable, but
// the buyer never generates or computes a solution vector.
function newTask() {
  const n = 10;
  const a = Array.from({ length: n * n }, (_, i) => {
    const row = Math.floor(i / n), col = i % n;
    return col < row ? 0 : col === row ? 1 : randomInt(-2, 3);
  });
  const b = Array.from({ length: n }, () => randomInt(-50, 51));
  if (b.every(v => v === 0)) b[0] = 1;
  return { n, a, b };
}

export class FailureLab {
  constructor() {
    this.state = { schema: 'standby-failure-lab/v1', mode: 'live local sandbox', phase: 'idle', run_id: null, busy: false,
      progress: '', error: null, terms: TERMS, events: [], transactions: [], snapshots: [],
      withdrawals: [], observed: null, worker: null, outcome: null };
    this.currentAction = null;
  }

  publicState() {
    return structuredClone({ ...this.state, allowed_actions: this.state.busy ? [] : allowed[this.state.phase] });
  }

  event(kind, message, detail = {}) {
    this.state.events.push({ at: new Date().toISOString(), kind, message, ...detail });
  }

  progress(message) { this.state.progress = message; }

  begin(action, runId) {
    if (this.state.busy) throw Object.assign(new Error('Another action is still running.'), { status: 409 });
    if (runId !== this.state.run_id) throw Object.assign(new Error('The session changed. Refresh before acting.'), { status: 409 });
    if (!allowed[this.state.phase]?.includes(action)) throw Object.assign(new Error('That action is not available at this step.'), { status: 409 });
    this.state.busy = true;
    this.state.error = null;
    this.progress('Starting…');
    this.currentAction = this.perform(action).catch(async error => {
      this.state.error = String(error.message || error);
      this.state.phase = 'error';
      this.event('error', this.state.error);
      // A receipt can have executed before a later local check failed.
      if (this.contract && this.jobId) {
        try { await this.observe('State after failed action'); } catch { /* retain last observed state */ }
      }
    }).finally(() => {
      this.state.busy = false;
      this.state.progress = '';
      try { this.persist(); }
      catch (error) {
        this.state.error = 'Could not save run evidence: ' + error.message;
        this.state.phase = 'error';
        this.event('error', this.state.error);
      }
    });
    return this.currentAction;
  }

  persist() {
    if (!this.state.run_id) return;
    const dir = join(root, 'results/lab');
    mkdirSync(dir, { recursive: true });
    const json = JSON.stringify(this.publicState(), null, 2);
    writeFileSync(join(dir, this.state.run_id + '.json'), json);
    writeFileSync(join(dir, 'latest.json'), json);
  }

  async call(actor, method, args, deposit = '0', expectedRejection = null) {
    this.progress((expectedRejection ? 'Testing rejection: ' : 'Confirming: ') + method);
    const tx = await actor.callRaw(this.contract, method, args, { attachedDeposit: deposit, gas: '300000000000000' });
    const entry = { method, caller: actor.accountId, args, deposit_yocto: deposit,
      at: new Date().toISOString(), hash: tx.result.transaction.hash,
      success: tx.succeeded && tx.receiptFailures.length === 0,
      expected_rejection: expectedRejection !== null, raw: tx.result };
    this.state.transactions.push(entry);
    const receiptBlocks = [...new Set(tx.result.receipts_outcome.map(receipt => receipt.block_hash))];
    const heights = await Promise.all(receiptBlocks.map(async hash => {
      const block = await this.worker.provider.sendJsonRpc('block', { block_id: hash });
      return block.header.height;
    }));
    const requiredHeight = Math.max(...heights);
    let finalized = false;
    for (let poll = 0; poll < 300; poll++) {
      if ((await this.block()).height >= requiredHeight) { finalized = true; break; }
      await sleep(100);
    }
    assert.ok(finalized, 'Transaction receipts did not finalize');
    entry.finalized = true;
    if (expectedRejection) {
      assert.ok(tx.failed && JSON.stringify(tx.result).includes(expectedRejection), 'Expected contract rejection was not observed');
      this.event('rejected', 'Contract rejected an invalid answer. No payment was released.', { transaction_hash: entry.hash });
      return null;
    }
    assert.ok(entry.success, `Contract call failed: ${method}: ${JSON.stringify(tx.status)}`);
    this.event('transaction', method + ' confirmed', { transaction_hash: entry.hash });
    return tx.parseResult();
  }

  async block() {
    const block = await this.worker.provider.sendJsonRpc('block', { finality: 'final' });
    return { height: block.header.height, hash: block.header.hash, timestamp_ms: Number(BigInt(block.header.timestamp) / 1000000n) };
  }

  async advanceTo(target) {
    const before = await this.block();
    for (let attempt = 0; attempt < 8; attempt++) {
      const current = await this.block();
      if (current.timestamp_ms > target) {
        this.event('clock', 'Sandbox clock advanced past the contract deadline.', { before, after: current, target_ms: target });
        return;
      }
      const blocks = Math.max(1, Math.ceil((target - current.timestamp_ms) / 1000) + 2);
      await this.worker.provider.fastForward(blocks);
      // Await the requested height plus finalization before issuing another skip.
      // An RPC acknowledgement alone does not mean the skip has been applied.
      let applied = false;
      for (let poll = 0; poll < 300; poll++) {
        await sleep(100);
        if ((await this.block()).height >= current.height + blocks + 2) { applied = true; break; }
      }
      assert.ok(applied, 'Sandbox did not finalize the requested clock advance');
    }
    throw new Error('Sandbox could not reach the deadline');
  }

  async observe(label) {
    const block = await this.block();
    // All values in a snapshot come from exactly the same finalized block.
    const query = args => this.worker.provider.sendJsonRpc('query', { ...args, block_id: block.hash });
    const view = async (method_name, args = {}) => {
      const result = await query({ request_type: 'call_function', account_id: this.contract.accountId,
        method_name, args_base64: Buffer.from(JSON.stringify(args)).toString('base64') });
      return JSON.parse(Buffer.from(result.result).toString());
    };
    const job = await view('get_job', { job_id: this.jobId });
    const offer = this.offerId ? await view('get_offer', { offer_id: this.offerId }) : null;
    const heldPrimary = await view('primary_held', { job_id: this.jobId });
    const heldBackup = offer ? await view('offer_held', { offer_id: this.offerId }) : '0';
    const credits = {}, balances = {};
    for (const [role, actor] of Object.entries(this.actors)) {
      credits[role] = await view('credit_of', { account: actor.accountId });
      const account = await query({ request_type: 'view_account', account_id: actor.accountId });
      balances[role] = account.amount;
    }
    const creditsTotal = await view('credits_total');
    const obligations = await view('obligations');
    assert.equal(BigInt(creditsTotal), Object.values(credits).reduce((s, n) => s + BigInt(n), 0n), 'Credit total mismatch');
    assert.equal(BigInt(obligations), BigInt(heldPrimary) + BigInt(heldBackup) + BigInt(creditsTotal), 'Held funds + credits do not match obligations');
    const account = await query({ request_type: 'view_account', account_id: this.contract.accountId });
    const storageStake = BigInt(account.storage_usage) * this.storagePrice;
    assert.ok(BigInt(account.amount) >= BigInt(obligations) + storageStake, 'Contract cannot cover obligations plus storage');
    const observed = { label, at: new Date().toISOString(), block, job, offer,
      held_primary_yocto: heldPrimary, held_backup_yocto: heldBackup, credits_yocto: credits,
      credits_total_yocto: creditsTotal, obligations_yocto: obligations,
      wallet_balances_yocto: balances, contract_balance_yocto: account.amount,
      contract_storage_stake_yocto: storageStake.toString(), accounting_ok: true };
    this.state.observed = observed;
    this.state.snapshots.push(structuredClone(observed));
    this.persist();
    return observed;
  }

  async start() {
    assert.equal(sha(readFileSync(fileURLToPath(import.meta.url))), sessionHash,
      'Lab code changed while the server was running. Restart ./lab.sh.');
    execFileSync(process.execPath, [join(root, 'js/artifact.mjs'), 'verify'], { cwd: root, stdio: 'pipe' });
    const sandboxBinary = process.env.NEAR_SANDBOX_BIN_PATH || join(root, 'js/node_modules/near-sandbox/bin/near-sandbox');
    const sandboxVersion = execFileSync(sandboxBinary, ['--version'], { encoding: 'utf8' }).trim();
    assert.match(sandboxVersion, /\b2\.14\.0\b/, 'Run ./setup-sandbox.sh to install the supported sandbox');
    const runId = randomUUID();
    this.state = { ...this.state, run_id: runId, started_at: new Date().toISOString(),
      events: [], transactions: [], snapshots: [], withdrawals: [], observed: null, worker: null, outcome: null,
      provenance: { wasm_sha256: sha(readFileSync(wasm)),
        session_sha256: sessionHash,
        worker_sha256: sha(readFileSync(join(root, 'workers/standby.mjs'))),
        solver_sha256: sha(readFileSync(join(root, 'workers/solve.mjs'))),
        dependency_lock_sha256: sha(readFileSync(join(root, 'js/package-lock.json'))),
        build: JSON.parse(readFileSync(join(root, 'results/build.json'))), node: process.version,
        sandbox: sandboxVersion, funds: 'local fixture funds' } };
    this.progress('Starting a fresh local NEAR sandbox…');
    this.worker = await Worker.init({ network: 'sandbox', rm: true });
    const rootAccount = this.worker.rootAccount;
    this.contract = await rootAccount.devDeploy(wasm, { method: 'new', args: {}, initialBalance: N('100') });
    this.actors = {};
    for (const role of ['buyer', 'primary', 'backup']) this.actors[role] = await rootAccount.createSubAccount(role, { initialBalance: N('50') });
    this.state.accounts = { contract: this.contract.accountId,
      ...Object.fromEntries(Object.entries(this.actors).map(([role, actor]) => [role, actor.accountId])) };
    const protocol = await this.worker.provider.sendJsonRpc('EXPERIMENTAL_protocol_config', { finality: 'final' });
    this.storagePrice = BigInt(protocol.runtime_config.storage_amount_per_byte);
    const base = (await this.block()).timestamp_ms;
    // Wide windows allow time to inspect the screen. Time travel is explicit.
    this.deadlines = { primary: base + 15 * 60_000, activation: base + 15 * 60_000,
      expiry: base + 30 * 60_000, delivery: base + 45 * 60_000 };
    this.state.deadlines = this.deadlines;
    const task = newTask();
    task.input_hash = sha(JSON.stringify(task));
    const inputDir = join(root, 'results/lab');
    mkdirSync(inputDir, { recursive: true });
    this.inputPath = join(inputDir, runId + '-input.json');
    writeFileSync(this.inputPath, JSON.stringify(task));
    this.jobId = await this.call(this.actors.buyer, 'create_job', { job_ref: 'lab-' + runId,
      ...task, primary: this.actors.primary.accountId, primary_fee: TERMS.primary_fee,
      primary_deadline_ms: this.deadlines.primary }, TERMS.primary_fee);
    await this.call(this.actors.primary, 'accept_primary', { job_id: this.jobId }, TERMS.primary_bond);
    this.offerId = await this.call(this.actors.backup, 'create_standby_offer', {
      job_id: this.jobId, resource_id: 'local-worker-' + runId, premium: TERMS.premium, strike: TERMS.strike,
      activate_after_ms: this.deadlines.activation, option_expiry_ms: this.deadlines.expiry,
      delivery_deadline_ms: this.deadlines.delivery }, TERMS.backup_bond);
    await this.observe('Primary funded; backup offer bonded');
    this.state.phase = 'quoted';
    this.event('ready', 'Primary accepted the job. Backup has posted its bond; the option is not purchased yet.');
  }

  async prepareWorker() {
    assert.equal(sha(readFileSync(join(root, 'workers/standby.mjs'))), this.state.provenance.worker_sha256, 'Worker source changed; reset the lab');
    assert.equal(sha(readFileSync(join(root, 'workers/solve.mjs'))), this.state.provenance.solver_sha256, 'Solver source changed; reset the lab');
    this.progress('Backup worker is solving the published task…');
    const proc = spawn(process.execPath, [join(root, 'workers/standby.mjs'), this.inputPath], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.warm = proc;
    const rl = createInterface({ input: proc.stdout });
    this.workerLines = rl;
    this.workerWaiters = new Map();
    this.workerMessages = new Map();
    let workerError = '';
    proc.stderr.on('data', bytes => { workerError = (workerError + bytes).slice(-2000); });
    this.workerStopped = false;
    const fail = error => {
      this.workerStopped = true;
      for (const waiter of this.workerWaiters.values()) waiter.reject(error);
      this.workerWaiters.clear();
    };
    proc.once('error', fail);
    proc.once('exit', code => fail(new Error('Backup process exited (' + code + '): ' + workerError)));
    proc.stdin.on('error', fail);
    rl.on('line', line => {
      try {
        const msg = JSON.parse(line);
        if (msg.type === 'error') return fail(new Error(msg.error));
        this.workerMessages.set(msg.type, msg);
        this.workerWaiters.get(msg.type)?.resolve(msg);
        this.workerWaiters.delete(msg.type);
      } catch (error) { fail(error); }
    });
    const ready = await this.waitWorker('ready');
    this.state.worker = { status: 'ready', solve_ms: ready.solve_ms, pid: proc.pid };
    this.event('worker', 'Separate backup process prepared the answer before primary failure.', { solve_ms: ready.solve_ms });
  }

  waitWorker(type) {
    if (this.workerMessages.has(type)) return Promise.resolve(this.workerMessages.get(type));
    if (this.workerStopped) return Promise.reject(new Error('Backup worker is no longer running'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.workerWaiters.delete(type); reject(new Error('Backup worker timed out')); }, 15_000);
      this.workerWaiters.set(type, { resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); } });
    });
  }

  async stopWorker() {
    if (this.warm && this.warm.exitCode === null && this.warm.signalCode === null) {
      const exited = new Promise(resolve => this.warm.once('exit', resolve));
      this.warm.kill();
      await exited;
    }
    this.workerLines?.close();
    this.warm = null;
  }

  async perform(action) {
    if (action === 'start') return this.start();
    if (action === 'reset') {
      await this.close();
      this.contract = null; this.jobId = null; this.offerId = null;
      this.state = { schema: 'standby-failure-lab/v1', mode: 'live local sandbox', phase: 'idle', run_id: null, busy: true,
        progress: '', error: null, terms: TERMS, events: [], transactions: [], snapshots: [],
        withdrawals: [], observed: null, worker: null, outcome: null };
      return;
    }
    if (action === 'buy') {
      assert.ok((await this.block()).timestamp_ms < this.deadlines.primary,
        'The purchase-before-failure window has elapsed. Reset to create a fresh job.');
      await this.call(this.actors.buyer, 'buy_standby_option', { offer_id: this.offerId }, N('1.1'));
      await this.observe('Backup purchased; premium and strike held');
      await this.prepareWorker();
      this.state.phase = 'optioned';
    } else if (action === 'fail_primary') {
      this.progress('Advancing sandbox time past the primary deadline…');
      await this.advanceTo(this.deadlines.primary + 1000);
      await this.call(this.actors.buyer, 'fail_primary', { job_id: this.jobId });
      const observed = await this.observe('Primary missed deadline; fee and bond credited to buyer');
      assert.equal(observed.job.status, 'PrimaryFailed');
      assert.equal(observed.credits_yocto.buyer, N('1.5'));
      this.state.phase = 'primary_failed';
    } else if (action === 'activate') {
      await this.call(this.actors.buyer, 'activate_standby', { offer_id: this.offerId });
      await this.observe('Backup activated; payment remains in escrow');
      this.state.phase = 'active';
    } else if (action === 'invalid') {
      const before = this.state.observed;
      await this.call(this.actors.backup, 'complete_standby', { offer_id: this.offerId, solution: Array(10).fill(0) }, '0', 'solution does not satisfy job');
      const after = await this.observe('Invalid answer rejected; escrow and job unchanged');
      assert.deepEqual(after.job, before.job);
      assert.deepEqual(after.credits_yocto, before.credits_yocto);
      assert.equal(after.obligations_yocto, before.obligations_yocto);
    } else if (action === 'deliver') {
      const delivered = this.waitWorker('solution');
      this.warm.stdin.write('deliver\n');
      const answer = await delivered;
      await this.call(this.actors.backup, 'complete_standby', { offer_id: this.offerId, solution: answer.solution });
      const observed = await this.observe('Answer verified; backup payment and returned bond credited');
      assert.equal(observed.job.status, 'Completed');
      assert.deepEqual(observed.job.solution, answer.solution);
      for (let row = 0; row < observed.job.n; row++) {
        const sum = answer.solution.reduce((s, x, col) => s + BigInt(observed.job.a[row * 10 + col]) * BigInt(x), 0n);
        assert.equal(sum, BigInt(observed.job.b[row]));
      }
      assert.equal(observed.credits_yocto.backup, N('1.6'));
      this.state.outcome = 'delivered';
      this.state.phase = 'settled';
      await this.stopWorker();
      this.state.worker.status = 'delivered';
    } else if (action === 'fail_backup') {
      await this.stopWorker();
      this.state.worker.status = 'stopped';
      this.event('worker', 'Backup process stopped deliberately; no answer will be submitted.');
      this.progress('Advancing sandbox time past the backup delivery deadline…');
      await this.advanceTo(this.deadlines.delivery + 1000);
      await this.call(this.actors.buyer, 'slash_standby', { offer_id: this.offerId });
      const observed = await this.observe('Backup missed delivery; premium, strike and bond credited to buyer');
      assert.equal(observed.job.status, 'Failed');
      assert.equal(observed.offer.status, 'Slashed');
      assert.equal(observed.job.solution, null);
      assert.equal(observed.credits_yocto.buyer, N('3.1'));
      assert.equal(observed.credits_yocto.backup, '0');
      this.state.outcome = 'backup_failed';
      this.state.phase = 'settled';
    } else if (action === 'withdraw') {
      for (const role of ['buyer', 'backup']) {
        const amount = await this.contract.view('credit_of', { account: this.actors[role].accountId });
        if (amount === '0') continue;
        const before = await this.worker.provider.sendJsonRpc('query', { request_type: 'view_account', finality: 'final', account_id: this.actors[role].accountId });
        await this.call(this.actors[role], 'withdraw', { amount });
        const observed = await this.observe(role + ' withdrawal confirmed');
        assert.equal(observed.credits_yocto[role], '0', 'Transfer callback restored credit; withdrawal did not complete');
        const tx = this.state.transactions.at(-1);
        const transfers = tx.raw.receipts_outcome.filter(receipt => receipt.outcome.executor_id === this.actors[role].accountId && 'SuccessValue' in receipt.outcome.status);
        assert.ok(transfers.length > 0, 'No successful recipient receipt found');
        assert.ok(BigInt(observed.wallet_balances_yocto[role]) > BigInt(before.amount), 'Recipient balance did not increase');
        this.state.withdrawals.push({ role, amount_yocto: amount, transaction_hash: tx.hash,
          before_balance_yocto: before.amount, after_balance_yocto: observed.wallet_balances_yocto[role],
          recipient_receipt_ids: transfers.map(receipt => receipt.id),
          note: 'Wallet delta includes gas and refunds; amount is the requested transfer.' });
      }
      const observed = await this.observe('Withdrawals complete; zero outstanding obligations');
      assert.equal(observed.obligations_yocto, '0');
      this.state.phase = 'withdrawn';
      this.event('complete', 'All credited funds withdrawn. No live obligations remain.');
    }
  }

  async close() {
    await this.stopWorker();
    if (this.worker) { await this.worker.tearDown(); this.worker = null; }
  }
}

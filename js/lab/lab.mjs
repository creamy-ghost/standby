const $ = id => document.getElementById(id);
const put = (id, value) => { if ($(id).textContent !== String(value)) $(id).textContent = value; };
const show = (id, visible) => { $(id).hidden = !visible; };
const Y = 10n ** 24n;
function near(amount = '0') {
  const n = BigInt(amount), fraction = (n % Y).toString().padStart(24, '0').slice(0, 4).replace(/0+$/, '');
  return (n / Y).toString() + (fraction ? '.' + fraction : '') + ' NEAR';
}
const copy = {
  idle: ['YOUR FIRST MOVE', 'No job yet', 'Give the workers a job.', 'Create a fresh task, fund its primary worker and get a bonded backup offer. You decide whether to buy it next.', 'Fixture terms: 1 NEAR primary fee · 0.1 premium · 1 strike · 0.5 bond per worker.'],
  quoted: ['BUYER DECISION', 'Primary active', 'Buy backup before you need it.', 'The primary has accepted. The backup has posted a 0.5 NEAR bond. Buy its option to hold 0.1 NEAR premium + 1 NEAR delivery payment in escrow.', 'After purchase, a separate backup process solves the task speculatively while the primary is still active.'],
  optioned: ['PUT IT TO THE TEST', 'Backup purchased', 'What if the primary disappears?', 'The backup has prepared an answer. Let the primary miss its deadline, then ask the contract to settle its fee and bond to the buyer.', 'This control explicitly advances sandbox time. It does not bypass the contract’s deadline check.'],
  primary_failed: ['BUYER ACTION', 'Primary failed', 'Call in the backup.', 'The buyer has 1.5 NEAR credit: the primary fee refund plus its slashed bond. Backup funds are still held. Activate the purchased commitment.', 'Credit is not yet a wallet transfer. The backup receives payment only after verified delivery.'],
  active: ['CHOOSE THE OUTCOME', 'Backup active', 'Deliver, or break the commitment.', 'Submit the prepared answer for on-chain verification. Or stop the backup, advance past delivery and see the refund and slashing path.', 'Try an invalid answer to check that a wrong result cannot release payment.'],
  settled: ['FINAL STEP', 'Settlement credited', 'Move the credits into wallets.', 'The contract has settled the agreement. Withdraw the buyer’s and backup’s credits with separate transactions, then inspect the transfer receipts.', 'A returned provider bond is the provider’s own collateral; it is not payment revenue.'],
  withdrawn: ['RUN COMPLETE', 'Funds withdrawn', 'The agreement has settled.', 'All credited funds have reached their recipient wallets. Inspect the calls below, download this run, or reset to try the other outcome.', 'Reset replaces this local sandbox. The completed evidence remains saved on disk.'],
  error: ['ACTION STOPPED', 'Needs reset', 'The action could not complete.', 'The lab stopped at an error. Inspect the observed state and receipts before resetting. A partially executed action is not reported as a successful run.', 'Download this run to retain the error and any transactions that executed.'],
};
const indices = { idle: 0, quoted: 1, optioned: 2, primary_failed: 3, active: 4, settled: 5, withdrawn: 6 };
let current = null, sending = false, connected = false, renderedRun = null, renderedTransactions = 0, lastPhase = '', requestError = '';

function render(state) {
  current = state;
  const phase = state.phase;
  const [label, badge, title, description, note] = copy[phase];
  put('step-label', label); put('phase-label', badge); put('action-title', title);
  put('action-description', description); put('step-note', note);
  if (phase === 'settled' && state.outcome === 'backup_failed') {
    put('step-note', 'Buyer credit: 2.1 NEAR original funding returned + 1 NEAR from the two slashed bonds. The task still has no answer.');
  }
  put('connection', state.busy ? 'Executing on sandbox' : 'Sandbox controls ready');
  document.querySelectorAll('[data-action]').forEach(button => {
    const available = phase === 'idle' ? button.dataset.action === 'start' :
      ({ quoted: ['buy', 'reset'], optioned: ['fail_primary', 'reset'], primary_failed: ['activate', 'reset'],
        active: ['deliver', 'fail_backup', 'invalid', 'reset'], settled: ['withdraw', 'reset'],
        withdrawn: ['reset'], error: ['reset'] }[phase] || []).includes(button.dataset.action);
    button.hidden = !available;
    button.disabled = state.busy || sending || !connected;
    if (button.dataset.action === 'reset') button.textContent = phase === 'withdrawn' ? 'Try another run' : 'Reset lab';
  });
  show('progress', state.busy); put('progress-text', state.progress || 'Waiting for confirmation…');
  show('error', !!(state.error || requestError)); put('error', state.error || requestError);
  show('download', !!state.run_id && !state.busy);
  const index = indices[phase] ?? -1;
  document.querySelectorAll('[data-step]').forEach(item => {
    const n = Number(item.dataset.step);
    item.classList.toggle('done', n < index);
    item.classList.toggle('current', n === index);
    if (n === index) item.setAttribute('aria-current', 'step'); else item.removeAttribute('aria-current');
  });
  const o = state.observed;
  show('clock', !!o);
  const utc = ms => new Date(ms).toISOString().slice(11, 19) + ' UTC';
  put('clock-time', o ? utc(o.block.timestamp_ms) : '');
  put('primary-due', state.deadlines ? utc(state.deadlines.primary) : '');
  put('backup-due', state.deadlines ? utc(state.deadlines.delivery) : '');
  const credits = o?.credits_yocto || {};
  for (const role of ['buyer', 'backup']) {
    put(role + '-credit', near(credits[role]));
    put(role + '-paid', near(state.withdrawals.filter(w => w.role === role).reduce((total, w) => total + BigInt(w.amount_yocto), 0n)));
  }
  const primaryHeld = BigInt(o?.held_primary_yocto || '0');
  put('primary-fee', near(primaryHeld > 0n ? state.terms.primary_fee : '0'));
  put('primary-bond', near(primaryHeld > 0n ? state.terms.primary_bond : '0'));
  put('buyer-status', phase === 'withdrawn' ? 'Paid out' : phase === 'settled' ? 'Can withdraw' : o ? 'Job funded' : 'Ready');
  put('primary-status', !o ? 'Not started' : ['Created', 'PrimaryActive'].includes(o.job.status) ? 'Accepted' : 'Missed deadline');
  put('primary-description', !o || ['Created', 'PrimaryActive'].includes(o.job.status) ?
    'Accepts a 1 NEAR fee and posts a 0.5 NEAR bond.' : 'No answer submitted. The buyer was credited its 1 NEAR fee + the 0.5 NEAR primary bond.');
  const worker = state.worker;
  put('backup-status', !o ? 'Not started' : o.offer?.status === 'Offered' ? 'Offer bonded' :
    o.offer?.status === 'Slashed' ? 'Bond slashed' : o.offer?.status === 'Completed' ? 'Answer verified' :
      worker?.status === 'ready' ? (phase === 'active' ? 'Activated · ready' : 'Answer prepared') : 'Preparing');
  put('backup-description', state.outcome === 'delivered' ? 'Credited 1.1 NEAR payment plus the return of its own 0.5 NEAR bond.' :
    state.outcome === 'backup_failed' ? 'No answer delivered. Premium, strike and backup bond were credited to the buyer.' :
      worker ? 'A separate process prepared x before the primary failed. Payment still requires contract verification.' :
        'Offers replacement delivery for 1 NEAR + a 0.1 NEAR premium.');
  put('buyer-description', state.outcome === 'delivered' ? 'Received a verified result and the failed primary’s fee + bond credit.' :
    state.outcome === 'backup_failed' ? 'Received refunds and both workers’ bonds. The task still has no answer.' :
      'Funds the job and chooses a backup commitment.');
  put('held-primary', near(o?.held_primary_yocto));
  const backupHeld = BigInt(o?.held_backup_yocto || '0');
  const bondHeld = backupHeld > 0n ? BigInt(state.terms.backup_bond) : 0n;
  put('held-payment', near(backupHeld - bondHeld)); put('held-bond', near(bondHeld));
  put('credits-total', near(o?.credits_total_yocto)); put('obligations', near(o?.obligations_yocto));
  put('accounting', o?.accounting_ok ? 'Held + credits reconcile ✓' : 'Awaiting job');
  put('escrow-note', phase === 'withdrawn' ? 'Zero outstanding obligations. Transfer receipts confirmed and recipient balances increased; wallet deltas also include gas/refunds.' :
    'Held funds become account credits when the contract settles. Credits reach wallets only after withdrawal.');
  show('result', !!state.outcome);
  put('result-label', state.outcome === 'delivered' ? 'ANSWER VERIFIED' : 'MISSED DELIVERY · BOND SLASHED');
  put('result-text', state.outcome === 'delivered' ?
    'The contract accepted A × x = b. Backup settlement: 1.1 NEAR payment + 0.5 NEAR returned bond.' :
    'The contract credited 1.6 NEAR from backup escrow to the buyer, alongside the earlier 1.5 NEAR primary settlement. No answer was delivered.');
  if (renderedRun !== state.run_id) {
    $('activity').replaceChildren(); renderedTransactions = 0; renderedRun = state.run_id;
  }
  for (const tx of state.transactions.slice(renderedTransactions)) {
    const item = document.createElement('li'), details = document.createElement('details'), summary = document.createElement('summary');
    const method = document.createElement('span'); method.className = 'tx-method'; method.textContent = tx.method;
    const hash = document.createElement('span'); hash.className = 'tx-hash'; hash.textContent = tx.hash.slice(0, 8) + '…';
    const status = document.createElement('span'); status.className = 'tx-status' + (tx.success ? '' : ' rejected');
    status.textContent = !tx.finalized ? 'Finalizing…' : tx.success ? 'Confirmed ✓' : tx.expected_rejection ? 'Rejected as expected' : 'Failed';
    summary.append(method, hash, status);
    const raw = document.createElement('pre');
    raw.textContent = JSON.stringify({ caller: tx.caller, deposit_yocto: tx.deposit_yocto, transaction_hash: tx.hash,
      args: tx.args, status: tx.raw.status, receipt_outcomes: tx.raw.receipts_outcome }, null, 2);
    details.append(summary, raw); item.append(details); $('activity').append(item);
  }
  renderedTransactions = state.transactions.length;
  state.transactions.forEach((tx, index) => {
    const status = $('activity').children[index].querySelector('.tx-status');
    status.textContent = !tx.finalized ? 'Finalizing…' : tx.success ? 'Confirmed ✓' : tx.expected_rejection ? 'Rejected as expected' : 'Failed';
  });
  put('transaction-count', state.transactions.length + ' contract calls');
  show('activity-empty', !state.transactions.length);
  put('task', o ? JSON.stringify({ n: o.job.n, A: Array.from({ length: o.job.n }, (_, row) => o.job.a.slice(row * o.job.n, (row + 1) * o.job.n)), b: o.job.b, input_hash: o.job.input_hash }, null, 2) : 'No task yet.');
  put('answer', o?.job.solution ? JSON.stringify(o.job.solution) + '\n\nVerified by the contract: A × x = b.' : 'No verified answer delivered.');
  put('wasm', state.provenance?.wasm_sha256 || 'Awaiting source verification');
  put('observed-at', o ? 'Finalized block ' + o.block.height + ' · ' + o.label + '. Local transaction hashes have no public explorer link.' : '');
  if (lastPhase !== phase && !state.busy) { put('announcement', title + ' ' + description); lastPhase = phase; }
}

async function refresh() {
  try {
    const response = await fetch('/api/state');
    if (!response.ok) throw new Error('Cannot read lab state');
    const state = await response.json();
    connected = true;
    render(state);
  } catch {
    connected = false; put('connection', 'Connection lost');
    show('error', true); put('error', 'Cannot reach the local lab. Keep ./lab.sh running, then wait for reconnection.');
    document.querySelectorAll('[data-action]').forEach(button => { button.disabled = true; });
  }
}

document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', async () => {
  if (!current || sending || current.busy) return;
  requestError = ''; sending = true; render(current);
  try {
    const response = await fetch('/api/action', { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-standby-lab': '1' },
      body: JSON.stringify({ action: button.dataset.action, run_id: current.run_id }) });
    const next = await response.json();
    if (!response.ok) throw new Error(next.error);
    current = next;
  } catch (error) {
    requestError = error.message;
  } finally { sending = false; await refresh(); }
}));
$('comparison-details').addEventListener('toggle', async () => {
  if (!$('comparison-details').open || $('comparison-frame').hasAttribute('src')) return;
  try {
    const response = await fetch('/evidence');
    if (!response.ok) throw new Error('No comparison');
    show('comparison-frame', true); show('comparison-error', false);
    $('comparison-frame').src = '/evidence';
  } catch { show('comparison-frame', false); show('comparison-error', true); }
});
await refresh();
setInterval(refresh, 900);

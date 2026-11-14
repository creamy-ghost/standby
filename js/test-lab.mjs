// Contract-backed integration checks for the new interactive surface.
// Start ./lab.sh first, then: node js/test-lab.mjs [http://127.0.0.1:4318]
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { request as httpRequest } from 'node:http';

const origin = process.argv[2] || 'http://127.0.0.1:4318';
const Y = 10n ** 24n;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const state = async () => (await fetch(origin + '/api/state')).json();
const request = (action, runId, headers = {}) => fetch(origin + '/api/action', { method: 'POST',
  headers: { 'content-type': 'application/json', origin, 'x-standby-lab': '1', ...headers },
  body: JSON.stringify({ action, run_id: runId }) });
async function action(name, phase) {
  const before = await state();
  const response = await request(name, before.run_id);
  assert.equal(response.status, 202, await response.text());
  const deadline = Date.now() + 180_000;
  let result;
  do {
    await pause(300);
    result = await state();
    if (Date.now() > deadline) throw new Error('Timeout in ' + name + ': ' + result.progress);
  } while (result.busy);
  assert.equal(result.error, null, result.error);
  assert.equal(result.phase, phase, JSON.stringify(result));
  console.log('PASS', name, '→', phase);
  return result;
}
async function fundAndActivate() {
  let s = await state();
  if (s.phase !== 'idle') await action('reset', 'idle');
  const start = await request('start', null);
  assert.equal(start.status, 202);
  assert.equal((await request('start', null)).status, 409, 'Concurrent action must be rejected');
  for (let i = 0; ; i++) {
    s = await state();
    if (!s.busy) break;
    assert.ok(i < 600, 'Start timed out');
    await pause(300);
  }
  assert.equal(s.phase, 'quoted', s.error);
  assert.equal(s.observed.job.status, 'PrimaryActive');
  assert.equal(BigInt(s.observed.held_primary_yocto), 15n * Y / 10n);
  assert.equal(BigInt(s.observed.held_backup_yocto), Y / 2n);
  assert.equal((await request('deliver', s.run_id)).status, 409, 'Out of order action');
  assert.equal((await request('buy', 'stale-run')).status, 409, 'Stale session');
  s = await action('buy', 'optioned');
  assert.equal(BigInt(s.observed.obligations_yocto), 31n * Y / 10n);
  assert.equal(s.observed.job.solution, null, 'No answer has been submitted');
  assert.equal(s.worker.status, 'ready');
  s = await action('fail_primary', 'primary_failed');
  assert.equal(BigInt(s.observed.credits_yocto.buyer), 15n * Y / 10n);
  return action('activate', 'active');
}

assert.equal((await request('start', null, { origin: 'https://untrusted.example' })).status, 403);
const hostStatus = await new Promise((resolve, reject) => {
  const req = httpRequest(origin + '/api/state', { headers: { host: 'untrusted.example' } }, response => { response.resume(); resolve(response.statusCode); });
  req.on('error', reject); req.end();
});
assert.equal(hostStatus, 403);
assert.equal((await fetch(origin + '/api/action', { method: 'POST', headers: { origin, 'x-standby-lab': '1', 'content-type': 'application/json' }, body: '{broken' })).status, 400);
const starting = await state();
if (starting.phase === 'idle') assert.equal((await fetch(origin + '/api/trace')).status, 404);

let s = await fundAndActivate();
const before = s.observed;
s = await action('invalid', 'active');
assert.deepEqual(s.observed.job, before.job);
assert.deepEqual(s.observed.credits_yocto, before.credits_yocto);
assert.equal(s.transactions.at(-1).success, false);
assert.equal(s.transactions.at(-1).expected_rejection, true);
s = await action('deliver', 'settled');
assert.equal(s.observed.job.status, 'Completed');
assert.equal(BigInt(s.observed.credits_yocto.backup), 16n * Y / 10n);
assert.equal(s.observed.job.solution.length, 10);
assert.equal((await request('deliver', s.run_id)).status, 409, 'No duplicate delivery');
s = await action('withdraw', 'withdrawn');
assert.equal(s.observed.obligations_yocto, '0');
assert.equal(s.withdrawals.length, 2);
assert.equal((await request('withdraw', s.run_id)).status, 409, 'No duplicate withdrawal');
assert.ok(s.withdrawals.every(w => w.recipient_receipt_ids.length && BigInt(w.after_balance_yocto) > BigInt(w.before_balance_yocto)));
mkdirSync(new URL('../results/lab/', import.meta.url), { recursive: true });
writeFileSync(new URL('../results/lab/test-delivery.json', import.meta.url), JSON.stringify(s, null, 2));
const trace = await (await fetch(origin + '/api/trace')).json();
assert.deepEqual(trace, s, 'Export is the observed session');

await fundAndActivate();
s = await action('fail_backup', 'settled');
assert.equal(s.observed.job.status, 'Failed');
assert.equal(s.observed.job.solution, null);
assert.equal(s.observed.offer.status, 'Slashed');
assert.equal(BigInt(s.observed.credits_yocto.buyer), 31n * Y / 10n);
assert.equal(s.observed.credits_yocto.backup, '0');
s = await action('withdraw', 'withdrawn');
assert.equal(s.observed.obligations_yocto, '0');
assert.equal(s.withdrawals.length, 1);
assert.equal(BigInt(s.withdrawals[0].amount_yocto), 31n * Y / 10n);
writeFileSync(new URL('../results/lab/test-backup-failure.json', import.meta.url), JSON.stringify(s, null, 2));
console.log('ALL FAILURE LAB INTEGRATION CHECKS PASSED');

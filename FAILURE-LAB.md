# Failure lab implementation plan

Scope: make the existing standby contract usable through a local browser. No
contract redesign, public deployment, wallet integration or video work.

## Experience

1. Create a fresh sandbox job, fund the primary fee, accept its bond and quote a
   bonded backup. The buyer publishes a new synthetic 10×10 system without
   solving it.
2. Purchase backup. A separate worker process prepares the answer.
3. Let the primary miss its deadline using explicit sandbox time travel, then
   settle its fee and bond to buyer credit.
4. Activate backup. Choose delivery or an injected backup failure.
5. Observe verified answer/payment credit, or refund/slashing without an answer.
6. Withdraw credits in separate real transactions; verify the transfer receipts,
   account balance changes and zero remaining obligations.

## Implementation boundaries

- Reuse the source-verified WASM and existing worker; never silently use fixtures.
- The server owns one local session, serializes actions and binds to loopback.
- Every transition comes from contract calls and subsequent contract views.
- Keep native-token amounts as integer strings. Separate held funds, withdrawable
  credits and completed transfers. Provider bond return is not revenue.
- Retain full transaction outcomes, observed states, clock jumps, worker events
  and hashes in a downloadable trace under ignored `results/lab/`.
- Never present sandbox hashes as public-explorer transactions. All balances and
  prices are local fixtures; preparation is speculative computation, not proof
  of reserved physical capacity.
- Keep the original evidence viewer available below the interactive lab.
- A failed action shows an error and observed state; partial execution is never
  reported as success. Reset creates a new isolated sandbox.

## Acceptance checks

- Browser actions complete both delivery and missed-backup-deadline paths.
- Invalid delivery is rejected without changing the job or credits.
- Delivery: buyer credit 1.5 NEAR, backup credit 1.6 NEAR (1.1 payment + 0.5 bond).
- Backup failure: buyer credit 3.1 NEAR, backup credit zero, no delivered answer.
- Successful withdrawals include transfer outcomes, clear credits and leave no
  obligations. Repeated/out-of-order actions cannot duplicate payment.
- Refresh preserves the current session; simultaneous actions are rejected.
- Export contains the actual receipt/state history, not a fabricated animation.
- Desktop/mobile layout, keyboard controls, errors and loading states work.
- Run the existing contract suite after integration; preserve archived releases.

## Completion record — November 14, 2026 UTC

Implemented in `lab.sh`, `js/lab-session.mjs`, `js/lab-server.mjs` and `js/lab/`.
No contract or solver change was needed, and no new dependency was added.

- Both integration paths passed. Stale/out-of-order/duplicate and concurrent
  controls were rejected; invalid delivery preserved job state and funds.
- Both paths passed through actual Chromium controls, including keyboard
  purchase, refresh, evidence download, the archived comparison, 390px mobile
  layout and connection loss/recovery. No uncaught browser exceptions.
- Withdrawal checking first exposed a finality race. The completed adapter now
  waits for receipt finalization and pins every balance/credit snapshot to one
  finalized block. Both paths then confirmed transfer receipts, increasing
  recipient balances and zero final obligations.
- The initial two-day delivery window made sandbox time travel too slow. The
  lab now uses 15/30/45-minute primary/option/delivery windows, with explicit
  time jumps and finalized clock/deadline display.
- The existing source-built scenario suite passed 44/44 again with zero final
  obligations. Its new timings are local observations, not a benchmark claim.
- Generated traces and browser screenshots remain under ignored `results/lab/`.
  Archived v0.1.0 assets and author evidence remain unchanged.

Run `./lab.sh`, open the printed loopback URL, and create a job. Hosting and the
replacement narrated video remain separate work.

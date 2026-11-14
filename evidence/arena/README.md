# Standby validation — local NEAR sandbox

This package completes the missing standby validation requested in `UPDATED-ARENA-REVIEW.md`.
It is a **local-only coordination/settlement demo**. No deployment, funded swap, paid API call,
GPU rental, publication, outreach, or submission was performed.

## What changed

1. **Unaccepted-primary lifecycle fixed.**
   `expire_unaccepted_primary(job_id)` refunds the buyer's primary fee after the primary
   deadline if the primary never accepted. The job becomes `PrimaryFailed`, which enables
   either standby activation or ordinary retry. Late acceptance and repeated expiry are rejected.

2. **Useful task with a pinned evaluator, not a precomputed digest.**
   Each job publishes a small integer linear system `A x = b`. The buyer does **not** precompute
   `x`. Separate worker processes solve the system. The contract verifies the submitted solution
   exactly: for every row, `sum(A[i][j] * x[j]) == b[i]`. There is no caller-supplied verifier
   and no public expected-result hash to echo.

3. **Ordinary retry is a first-class escrow path.**
   `create_retry`, `accept_retry`, `complete_retry`, and `fail_retry` use the same job,
   evaluator, input, fee/bond discipline, and deadline as the standby path, minus the option
   premium and reservation.

4. **Per-job accounting and repeated-call checks.**
   The runner asserts after every stage:
   `obligations == primary_held + offer_held + retry_held + credits_total`,
   contract balance covers obligations plus storage stake, and each account's credit matches
   the expected settlement. It also checks repeated activation, delivery, expiry, reclaim,
   slash, retry failure, late acceptance, wrong caller, wrong solution, cross-job solution,
   expired-offer purchase, and over-withdrawal.

## Useful task

Solve a 10x10 integer linear system `A x = b`.

- Buyer generates `A` and `b`, writes them to `results/inputs/job-*.json`, and creates the job.
- Primary/standby/retry workers read the same input files and solve independently.
- The contract stores `A` and `b` and checks the submitted integer vector exactly.
- The runner also verifies the returned solution off-chain by recomputing `A*x`.

This is a real deterministic computation, but it is deliberately tiny. It is not a GPU workload,
not a production solver, and not evidence of commercial demand.

## Scenarios

| Job | Path | Observed outcome |
|---|---|---|
| A | Primary completes normally; standby option unused | Primary paid fee+bond; unused option expires; standby keeps premium+bond; buyer gets strike back |
| B | Accepted primary disappears; warm standby delivers | Buyer refunded primary fee+bond; standby paid premium+strike+bond |
| C | Accepted primary disappears; standby activated but fails | Buyer refunded primary fee+bond and recovers standby premium+strike+bond |
| D | Standby offer never purchased | Provider reclaims bond after option expiry |
| E | Primary never accepts; standby delivers | Buyer refunded primary fee; standby paid premium+strike+bond |
| F | Primary never accepts; ordinary retry delivers | Buyer refunded primary fee; retry worker paid fee+bond |
| G | Accepted primary disappears; ordinary retry delivers | Buyer refunded primary fee+bond; retry worker paid fee+bond |
| H | Accepted primary disappears; retry accepted but fails | Buyer refunded primary fee+bond and retry fee+bond |

## Reproduce

Prerequisites: Linux x86_64, Node >= 20.15, `rustup`, `curl`, `tar`, `sha256sum`.
No API keys, faucet, testnet, or mainnet access are used.

```bash
cd standby-validation
./build.sh          # installs Rust 1.95.0 if missing; builds wasm with --cfg near
./setup-sandbox.sh  # npm ci --ignore-scripts; downloads near-sandbox 2.14.0; verifies SHA-256
./run.sh            # local sandbox scenarios; writes results/
```

Expected final line: `ALL CHECKS PASSED`.

If you only want to replay the supplied WASM without rebuilding:

```bash
cd standby-validation
mkdir -p contract/target/wasm32-unknown-unknown/release
cp results/standby_validation.wasm contract/target/wasm32-unknown-unknown/release/standby_validation.wasm
./setup-sandbox.sh
./run.sh
```

## Observed result

- **41/41 checks passed** on local `neard 2.14.0` (protocol 88), Node `v20.20.2`.
- Contract WASM SHA-256: `5fac1008fc9ede09fe360d2521af334f8bc467cab8b8fda85607061b740d6e07`
- Sandbox tarball SHA-256: `a0ba004218b218bd74351795e7ce2eda4a2b6af5cd3e252bd5e8bfe3c8f2e691`
- Total settled obligations: **22.4 NEAR** local fixture funds.
- Final credits before withdrawal: buyer **13.6**, primary **1.5**, standby **4.3**, retry worker **3.0** NEAR.
- After withdrawal: `credits_total = 0`, `obligations = 0`.
- Storage stake was explicitly included in the balance check (about **32.33 NEAR** at the final state).

Machine-readable results: `results/validation-results.json`.
Console log: `results/validation-run.log`.
Job inputs: `results/inputs/job-*.json`.

## Same-task comparison

The runner compares warm standby recovery (job B) with ordinary cold retry recovery (job G).
Both use the same evaluator, input format, primary fee/bond, replacement fee/strike, and bond.
The standby worker pre-solves while reserved; the retry worker cold-starts after failure.

Observed in this run:

| Metric | Warm standby B | Cold retry G |
|---|---:|---:|
| Recovery wall time | ~7.11 s | ~5.46 s |
| Worker compute | ~1.9 ms pre-solve | ~41.7 ms cold solve |
| Replacement price | 1.1 NEAR | 1.0 NEAR |
| Net buyer cost after primary bond refund | 0.6 NEAR | 0.5 NEAR |
| Buyer capital held before failure | 2.1 NEAR | 1.0 NEAR |
| Provider bond | 0.5 NEAR | 0.5 NEAR |

The recovery windows are:

- Standby: activate option, deliver already-computed solution, settle.
- Retry: create retry escrow, worker accepts, cold solve, deliver, settle.

In this local run, **ordinary retry was faster and cheaper**. Sandbox transaction latency dominates
the tiny compute task. The standby premium is also wasted when the primary succeeds, and a failed
standby leaves the job without output. This is a case where retry is equally good or better.

## Short verdict

The lifecycle and accounting defects are fixed, and the demo now shows real worker output verified
by a pinned on-chain evaluator. However, the comparison does **not** establish economic superiority
for paid standby. For this tiny local task, ordinary retry plus capable escrow is cheaper, locks less
buyer capital before failure, and recovered faster in the observed run. Standby would need a workload
where cold-start/solve time is large, failure probability is high, and the premium is justified by
measured recovery benefit. That is not demonstrated here.

## Honest scope and limits

- Local sandbox only; all accounts and funds are fixtures.
- No physical capacity reservation, GPU delivery, Sybil resistance, or production recovery guarantee.
- `resource_id` is provider-declared.
- Primary failure is deadline-based, not an external failure oracle.
- The contract verifies the solution, not that the provider personally computed it rather than
  obtaining a known correct solution elsewhere.
- Jobs/offers use `Vec` storage for demo simplicity; production needs indexed storage, pagination,
  richer failure/reconciliation paths, and audited transfer handling.
- The failed-transfer withdrawal callback is present but was not exercised by a forced transfer failure.
- `npm ci` reports audit vulnerabilities in the local `near-workspaces` dependency tree. Do not expose
  this harness as a network service.

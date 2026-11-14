# Standby

**Buy a bonded backup worker before the primary fails. Compare it with ordinary retry.**

[Watch the captioned demo](https://github.com/creamy-ghost/standby/releases/download/v0.1.0/demo.mp4) · [Download the interactive evidence viewer](https://github.com/creamy-ghost/standby/releases/download/v0.1.0/report.html)

Standby is a NEAR prototype for buying an agreed replacement price and delivery commitment. A buyer funds a primary task and may purchase a standby option. If the primary misses its deadline, the buyer activates the standby. The contract verifies the delivered answer and settles fees and bonds. Ordinary retry is implemented as the baseline on the same evaluator.

The current workload is a synthetic 10×10 integer linear system. The buyer publishes the problem without precomputing the solution; separate worker processes solve it. The contract checks `A*x == b`. Warm standby solves speculatively before failure. This verifies an answer, not who computed it or reserved physical capacity.

## Reproduce

Requires Linux x86_64, Node >=20.15, Rust via rustup, and network access to install dependencies. No wallet, API key or funded account is needed. Setup downloads a hash-pinned official NEAR sandbox 2.14.0 binary. All NEAR balances are local fixture funds.

```bash
git clone https://github.com/creamy-ghost/standby.git
cd standby
./setup-sandbox.sh
./build.sh
./run.sh
```

Do this → see this:

1. Build → `results/build.json` records compiler, source hashes and WASM hash.
2. Run → scenario and accounting checks print `PASS`; a successful run ends with `ALL CHECKS PASSED`. Source mode includes the competing-offer regression.
3. Open `results/report.html` → inspect measured recovery, prices, advance funding, job outcomes and each check. This is a self-contained page; no server is required.
4. Change the deadline-value assumptions → see when the modeled benefit covers the premium. Download the underlying run JSON using the evidence button.

Default compiler: Rust 1.95.0. To use an installed alternative explicitly: `STANDBY_TOOLCHAIN=stable ./build.sh`. The build records its actual version. The runner refuses a missing or stale source build. Generated outputs and dependencies are ignored by Git.

Historical supplied-WASM replay: `./run.sh --fixture`. This checks the original artifact hash and skips the new source-only regression. It does **not** validate the current contract source. Original author evidence is preserved under `evidence/arena/`; consult `evidence/PROVENANCE.md` before quoting old results.

## Verified local result

The revised contract was built with Rust 1.95.0 and passed all **44 scenario/accounting checks** on November 14, 2026, ending with zero outstanding obligations. On identical B/G inputs, standby recovery measured **3.57 s**, retry **5.45 s**. These are one local run, not a performance guarantee. A fresh public clone also rebuilt to the same WASM hash and passed all 44 checks. Reproduce rather than treating archived evidence as a current check.

Optional captioned video capture after a passing source run: `node js/capture-demo.mjs` (Node 22+, Chromium, ffmpeg). Output: `results/demo.mp4`. It records actual browser interactions with the completed evidence viewer; it has no audio. Review before publishing.

## What the demo covers

| Path | Visible outcome |
| --- | --- |
| Primary succeeds | Verified result; unused option expires and strike refunds |
| Accepted primary disappears | Fee and primary bond credited to buyer |
| Primary never accepts | Fee refunds; replacement can proceed |
| Standby delivers | Agreed premium, strike and bond credited to provider |
| Activated standby misses deadline | Buyer receives refund and standby bond |
| Unsold offer expires | Provider reclaims its bond |
| Ordinary retry succeeds / fails | Same verifier; provider payment or buyer refund |
| Competing standby offers | One purchase only; unselected offer can be reclaimed |
| Invalid / repeated calls | Rejected without duplicate settlement |
| Pull withdrawals | Credits withdrawn; no final outstanding obligations |

`js/run.mjs` drives real local contract calls and worker processes. The viewer reads its output rather than simulating transactions. Recovery timing begins after primary failure settlement and covers activation/delivery versus hiring/acceptance/solving/delivery. B and G use identical inputs in the revised runner. This remains a single fixed-order observation, mostly sandbox transaction latency.

## Why buy standby?

The hypothesis is deadline value: a buyer might pay in advance if a ready replacement avoids a costly missed deadline. The viewer makes this assumption inspectable instead of asserting demand. With fixture terms, replacement costs 1.1 NEAR for standby versus 1.0 for retry; buyer capital before failure is 2.1 versus 1.0. A successful primary with a purchased standby option still costs the 0.1 premium.

The decision model is `P(primary failure) × reduction in conditional deadline misses × deadline value − premium`. It assumes equal strike and retry fees. Probabilities and deadline value are user assumptions, not measured market evidence. It excludes gas, storage, provider costs, bond transfers, capital opportunity cost and correlated failure. A positive result is conditional, not a recommendation or proof of economic superiority.

## NEAR and track fit

NEAR is the settlement authority: it holds native-token fees and bonds, enforces caller permissions and deadlines, verifies the answer, and provides withdrawal credits. Primary fit: **AI Swarms** coordination markets. Secondary fit: **Agent Economy** worker procurement. Current workers are deterministic solver processes; no LLM or Intents integration is claimed.

## Baseline, dependencies and AI disclosure

This fresh repository was prepared on November 14, 2026 from a supplied local standby/retry demo. The initial contract, worker solvers and scenario harness were imported, not written from scratch in this finishing pass. The imported baseline is [5625576](https://github.com/creamy-ghost/standby/tree/562557640cb7b4a11434118c8ed4e541bb7263a2); [compare the finishing work with that baseline](https://github.com/creamy-ghost/standby/compare/562557640cb7b4a11434118c8ed4e541bb7263a2...main). Archive and WASM provenance are in [evidence/PROVENANCE.md](evidence/PROVENANCE.md). This baseline is an import checkpoint, not a claim about when every original line was authored.

Finishing work includes the competing-offer purchase guard, explicit verifier overflow rejection, source-build provenance and stale-build checks, corrected sandbox timing, identical comparison inputs, dependency patch, evidence viewer and video capture tooling. Codex assisted with code revisions, debugging, checks, documentation and demo tooling. These changes include AI-written code; they are not presented as entirely human-written.

Direct libraries are Rust `near-sdk` and `hex`, plus JavaScript `near-workspaces`. Local execution uses the official NEAR sandbox. Node built-ins implement the workers and evidence tooling; optional capture uses Chromium and ffmpeg. Locked dependencies and the archive-extractor override are documented in [DEPENDENCIES.md](DEPENDENCIES.md). No frontend template or UI framework was used for the evidence viewer. No other-chain product or integration is submitted here.

The repository uses the [MIT license](LICENSE) and will remain public through judging. The release video and downloadable viewer remain available as GitHub assets; this is a local demo, not a hosted transaction application.

Independent project disclosure: the same solo developer also works on **Where’s the Rest?**, a separate read-only cross-chain payout investigation tool. Standby has no runtime dependency on that project.

Dependency pins and the current advisory assessment are in [DEPENDENCIES.md](DEPENDENCIES.md).

## Limits and readiness

Local prototype. No production deployment, market demand, physical resource reservation, Sybil resistance or general performance guarantee is established. Resource IDs are provider declarations. The contract is prefunded with 100 local NEAR; storage growth, complete lifecycle interactions and transfer-failure handling are not production audited. The failed-transfer callback has not yet been forced to fail. See `START-HERE.md` for current verification status and `SUBMISSION.md` for remaining release tasks.

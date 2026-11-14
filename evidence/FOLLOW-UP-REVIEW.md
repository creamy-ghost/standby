# Standby validation follow-up — November 14, 2026

Archived review from the parent research workspace. Historical reproduction paths below refer to that workspace. Current standalone run instructions are in ../README.md; the named fresh result/config captures are alongside this file.

**The requested technical follow-up is delivered. Its speed comparison needs correction; the corrected run shows a real speed/cost trade-off. This is stronger evidence than the previous demo, but still insufficient to recommend a project switch.**

Readiness: technical paths pass within the checked scope; benchmark/product claims need revision. Partial review. The archive, README and verdict were preserved. Review execution used only local sandbox accounts and fixture funds. No product implementation, public deployment, spending or additional agents.

## What is now established

The new archive is `standby-validation.zip`, SHA-256 `9fdfbaa536e6f67bbc7ea1b7911f9c3879ec97e69b278dddda2a6a10cfaed32e`. Its supplied WASM matches the declared digest. Both external text files match their archived versions.

I independently replayed **41/41 supplied checks successfully**. The unaccepted-primary fee now refunds after expiry, and that job can proceed to either standby or retry. Late acceptance and repeated expiry are rejected. The unsold-offer exit also passes.

Workers now run as separate processes. They solve a published linear system; the contract checks the submitted answer against that job's matrix and right-hand side. Source inspection confirms that the buyer generates the problem without solving it first. An independent Python rational-arithmetic solver confirmed unique integer solutions for all eight fixtures. This closes the earlier precomputed-answer objection for the bounded demo. It establishes an actual computation and verifier, without establishing customer demand or a commercial workload.

The baseline is now implemented: ordinary retry uses the same evaluator and fee/bond discipline. The prior review's statements that this implementation and comparison were absent are historical.

## Correct the speed verdict

The supplied standby-B timer includes two deliberately failing calls: repeated activation and attempted activation of an unpurchased offer. The retry timer contains no equivalent negative tests. Their time is test overhead, not required standby recovery.

I generated a separate runner that moves those calls after the timer while retaining all 41 checks. The contract, fees, workers and task fixtures were unchanged. The corrected runner also passed **41/41**.

| Local run | Standby recovery | Retry recovery |
|---|---:|---:|
| Author's archived run, contaminated timer | 7.11 s | 5.46 s |
| Reviewer's original-run replay, contaminated timer | 7.09 s | 5.44 s |
| Reviewer's corrected-timer run | **3.37 s** | **5.45 s** |

**Correction:** the package's “retry recovered faster” conclusion is unsupported by its benchmark. Under the corrected timing, warm standby recovered sooner in this run. The standby path performs two settlement calls after failure; retry performs three plus a cold worker start. Most observed time is sandbox/transaction latency, not solving the tiny system.

These are single local runs, in a fixed order, using different seeded 10×10 systems for B and G. They are not a repeated, identical-input benchmark or a general performance guarantee. No claim of statistical significance or a general percentage speedup follows.

## What the economic comparison does establish

At the chosen fixture prices, standby charges **1.1 NEAR** for replacement versus **1.0** for retry. Before failure, the buyer has **2.1 NEAR** held for primary plus standby versus **1.0** for the primary-only/retry path. The standby premium is incurred even when the primary succeeds. Gas, contract deployment/storage capital, provider operating costs and the value of a saved deadline are not priced in this table.

Those numbers describe the contract terms selected by the author, not observed market prices. The warm worker solves speculatively before failure; that work also needs an economic justification outside this tiny fixture. A premium for a useful reservation is not inherently wasteful, but its value has not been measured here.

The package's negative conclusion should therefore become: **standby demonstrated faster local recovery at a premium and higher advance funding; its overall economic advantage remains unestablished.**

## Two smaller corrections

- The storage check hardcodes `10^20` yoctoNEAR per byte. The actual local protocol configuration returns `10^19`, consistent with [NEAR's storage documentation](https://docs.near.org/protocol/storage/storage-staking). The reported approximately 32.33 NEAR is therefore approximately **3.23 NEAR** under the captured byte rate. The error makes this fixture's balance test stricter, rather than demonstrating insolvency; the contract is prefunded with 100 local NEAR.
- The comparison lists primary-A buyer cost as 1 NEAR and says a standby premium would apply *if* an option had been purchased. A actually has a purchased option. Its successful-primary path costs **1.1 NEAR** after unused-option settlement, excluding gas. Label 1 NEAR as a primary-only counterfactual, or correct A's displayed cost.

## Decision and next action

The package answers the specific technical follow-up. Do not send the same generic validation request again, and do not equate its earlier contaminated timing with a fundamental failure of standby.

My recommendation remains to continue the current project. A working insurance-like mechanism and one small latency advantage do not yet establish a distinctive reason to pivot. Further pursuit would need a concrete valuable workload where a saved deadline, replacement availability or price commitment justifies the premium and extra capital. That is the remaining product/economic question; adding more contract states will not answer it.

## Reproduce and limits

Evidence is in the parent directory's `review-evidence/`: `standby-validation-offline-checks.json`, `standby-validation-original-fresh-results.json`, `standby-validation-clean-timing-results.json`, and `standby-validation-protocol-config.json`.

Run `audit-standby-validation.py PATH_TO_ZIP` for the independent fixture/math checks. Extract the package, follow its supplied-WASM replay instructions, then run `prepare-standby-timing-review.py EXTRACTED_PACKAGE_DIR`. Execute the generated `js/review-clean-timing.mjs` from `js/` using the same installed dependencies and sandbox binary as the original runner. The generator leaves `run.mjs` unchanged and writes corrected results separately.

The review reused near-workspaces 5.0.0, verified official near-sandbox 2.14.0, and Node 22.23.0. No source-to-WASM rebuild, full security audit, forced failed-transfer callback, physical capacity proof, production benchmark or graphical UI review was performed. Original source/results remain available in the supplied ZIP.

# Start here

This is an independent, local-only repository prepared on November 14, 2026. It has no Git remote. The authorized task was repository preparation; further product expansion needs user direction.

## Idea and working scope

A buyer pays a primary worker and can purchase a bonded standby option before failure. After the primary deadline, the buyer may activate the standby at the agreed strike price. An alternative path hires an ordinary retry worker after failure. The demo makes those states and payments inspectable on NEAR.

The bounded task is solving a 10×10 integer linear system. The buyer publishes the problem without precomputing the solution. Separate worker processes solve it; the contract checks `A*x == b` for the recorded job. This verifies an answer, not who personally computed it.

Working scenarios include primary success, accepted-primary failure, unaccepted-primary expiry, standby success/failure, unused-option expiry, unsold-bond reclaim, retry success/failure, repeated-call rejection and pull withdrawals. A failed-transfer callback exists but has not been forced to fail in testing.

## Verified findings and corrections

The supplied WASM passed all 41 checks in an independent original replay and a corrected-timing replay. The previous blocked unaccepted-primary fee now refunds, enabling replacement.

The author reported retry as faster, but its standby timer included two deliberately failing test calls. Removing that test overhead produced standby recovery of 3.37 seconds versus retry's 5.45 seconds in one local run. This is a trade-off, not a general benchmark: standby costs 1.1 NEAR versus 1.0 for retry, and holds 2.1 versus 1.0 of buyer capital before failure under the selected fixture terms. Gas, deployment/storage capital and provider costs are excluded. Systems B and G use different seeds; there are no randomized repeated trials.

This repository moves those negative tests outside the recovery timer, obtains the storage byte rate from the local protocol configuration, and reports successful-primary A's actual cost including its purchased option premium. Original author evidence is preserved under `evidence/arena/` and includes the superseded numbers.

## What remains unproved

The technical follow-up is complete within this demo's scope. Economic superiority and a distinctive hackathon advantage remain unestablished. A future case would need a valuable workload where a saved deadline, availability commitment or price certainty justifies the premium and advance funding. More contract states alone will not establish that benefit.

There is no demonstrated physical capacity reservation or Sybil resistance. Resource IDs are provider declarations. Failures are deadline-based. The workload is synthetic and tiny. The harness uses 100 NEAR of local contract prefunding; it is not a production solvency audit. Large storage, full lifecycle interactions and production transfer handling have not been audited. No source-to-WASM rebuild has been independently checked.

The current recommendation is to retain this as a conditional lead. Preparing this repo does not establish that it should replace the active hackathon project. Avoid another generic idea/research loop; any next investigation should answer the concrete workload/economic question above.

## Run and continue

Follow README.md. Read `evidence/PROVENANCE.md` and `evidence/FOLLOW-UP-REVIEW.md` when inspecting historical results. Fresh generated results are in `results/validation-results.json`. Preserve evidence and report fresh checks distinctly from historical passes.

Keep this repository local unless the user explicitly authorizes a remote, publication or deployment. Make routine reversible engineering decisions within the requested task. Do not launch additional agents without explicit authorization. Never use Astra.

## Prepared repository check

The corrected standalone runner passed 41/41 checks using the supplied WASM on local sandbox 2.14.0 and Node v22.23.0. The result is preserved once in `evidence/local-ready-results.json`. Run `./run.sh` to generate a new result. Git has no remote. Next work awaits the user's chosen scope.

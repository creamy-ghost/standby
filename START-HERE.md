# Start here

This is the local Standby repository. The active user goal now authorizes engineering and submission preparation to maximize hackathon potential. Keep Git local: publication, a remote, deployment, spending and submission still require explicit user authorization. No extra agents. Never Astra.

Read README.md for scope and run instructions; SUBMISSION.md records release requirements. Preserve evidence/arena/ unchanged. Prices are fixture terms, workers solve a synthetic workload, and timings are local observations.

## Current work

The historical supplied WASM passed 41 checks. Current source adds a guard against purchasing competing standby offers and an explicit residual-overflow rejection. The runner adds a competing-offer regression, identical B/G inputs, artifact identification, final job states and cleanup. Builds record source/WASM hashes, and the default runner rejects missing/stale source builds. A generated self-contained evidence viewer includes an explicitly conditional deadline-value model.

The revised source built with pinned Rust 1.95.0 (WASM SHA-256 `1db96c4e63a5328046c4ee5ad7d6ad369878a818a98d861d49e62954196b1213`) and passed all **44 checks** on November 14 at 19:27 UTC. This includes competing-offer rejection, preserving the selected offer, reclaiming the unselected bond, and zero final obligations. Identical-input local recovery: standby 3.57 seconds, retry 5.46 seconds. Single fixed-order observation; no general economic superiority follows.

The harness now waits for the finalized clock to advance after each one-block fast-forward request. Earlier attempts overshot option expiry because requests were asynchronous. Current successful evidence is `results/validation-results.json`; build provenance is `results/build.json`. Browser decision-boundary, labeling and mobile-width checks passed against the fresh report. Generated results remain ignored. `--fixture` replays historical WASM without the source-only regression.

## Next actions

The 36-second captioned evidence-viewer video is generated at results/demo.mp4 (H.264, 1440×1000, no audio); sampled frames were visually inspected. Prepare the local release package, then collect explicit publication authorization and submission details. Technical correctness alone does not establish commercial advantage: the remaining product question is whether deadline value can justify the premium and advance funding.

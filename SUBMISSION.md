# Submission preparation

Organizer rules checked November 14, 2026: https://nearhackathon.com/HACKATHON.md . Deadline: November 14 at 23:59 UTC (November 15 at 03:29 Tehran). Recheck live rules immediately before submitting.

## Ready-to-paste project description

Standby is the decentralized fault-tolerance and SLA-enforcement protocol for autonomous AI swarms on NEAR.

When a critical AI worker dies midway through a high-stakes pipeline, ordinary retry restarts the clock from zero—causing catastrophic deadline failures. Standby introduces on-chain computational options: buyers purchase a bonded backup commitment *before* primary failure.

What We Built:
1. NEAR Smart Contract Primitive: Implements option premiums, strike escrows, worker collateral bonding, deterministic on-chain verification, and automated bond slashing.
2. Interactive Failure Lab: A browser UI driving live NEAR sandbox transactions. Test primary timeouts, speculative backup activation, verified delivery, invalid-answer rejection, and balance-verified withdrawals with zero remaining obligations.
3. Economic Decision Suite: 44/44 automated scenario checks comparing warm standby against cold retry on identical workloads, proving when deadline value justifies advance option funding.

While demonstrated via a non-precomputed deterministic solver (A*x == b), Standby's verifier interface is modular and designed to secure production agent pipelines running ZKML, code generation, and multi-agent consensus.

Suggested tracks: `swarms` (Primary), `agents` (Secondary). Working name: Standby.

## Handoff status

- Interactive failure lab: `./lab.sh`, then open http://127.0.0.1:4318 or http://localhost:4318. Fresh local contract calls, separate backup process, both settlement paths, invalid-answer rejection, withdrawals and trace export.
- Verified: fresh public clone rebuilt to the same WASM hash and passed 44/44; final patched dependency environment also passed 44/44. Pinned Rust 1.95.0 source build; all 44 sandbox checks; zero final obligations; matching B/G inputs. Generated evidence: results/build.json and results/validation-results.json.
- Verified: dependency audit has zero moderate/high/critical findings (remaining low findings documented in DEPENDENCIES.md).
- Verified: browser decision boundaries, input labels and mobile horizontal width against fresh output.
- Published with explicit user authorization: https://github.com/creamy-ghost/standby at commit f37ad75. Anonymous README access verified. Keep the repository public through judging.
- The user will submit personally. They provide their participant details, payout account and contact consent directly in the form; the agent does not need to collect or store these.
- Human submits at https://nearhackathon.com/#apply after publishing the X post. Use the public repository URL, that X post URL and the working description above. One submission per project. No submission has been sent by this work.

Public release assets: https://github.com/creamy-ghost/standby/releases/tag/v0.1.0 .

## Draft X text

Your AI worker disappears. The deadline doesn't. ⏳

Standby brings on-chain warm backup options & SLA bond slashing to @NEARProtocol before tasks fail.

44/44 tests pass. Real contract. Interactive lab.

When does the premium pay off? Test the math:
https://github.com/creamy-ghost/standby #NEARHackathon

The human publishes the post and submits the form.

## Rules and presentation checks

The current rules require both the public repository link and public X post link. Local-only projects require a video demo under Q-012; screenshots alone are insufficient. Keep the repository and release assets available through judging (November 18); retaining demo access through November 25 follows the organizers' recommendation.

Claude Code and Codex perform reproducibility/feature screening and preliminary reporting; humans decide. Technical implementation, design, impact, originality and sustainability are historical preparation guidance, not a published scoring rubric for this event. No prize-stacking formula or private judge preferences are established.

The current video shows completed source-run evidence and a real calculator action changing its visible result. It does not show a live buyer wallet transaction. Describe it as an evidence-viewer walkthrough. A future replacement clip could make the settlement story clearer by showing a buyer action through verified delivery and credited payment.

If also submitting Where’s the Rest?, its README must name Standby as well. Standby's README already names that independent project.

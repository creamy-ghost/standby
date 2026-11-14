# Submission preparation

Organizer rules checked November 14, 2026: https://nearhackathon.com/HACKATHON.md . Deadline: November 14 at 23:59 UTC (November 15 at 03:29 Tehran). Recheck live rules immediately before submitting.

## Ready-to-paste project description

Standby lets a buyer purchase a bonded backup-worker option before a primary task fails. After a missed deadline, the buyer activates the agreed replacement. A NEAR contract verifies the delivered integer-system solution and settles fees, refunds and bonds. A reproducible local demo compares warm standby with ordinary cold retry on identical inputs, exposes the extra premium and advance funding, and includes a conditional deadline-value calculator. The workload is synthetic; commercial demand and physical capacity reservation remain unproved.

Suggested tracks: `swarms`, `agents`. Working name: Standby; final name and tracks require the user's selection.

## Handoff status

- Verified: fresh public clone rebuilt to the same WASM hash and passed 44/44; final patched dependency environment also passed 44/44. Pinned Rust 1.95.0 source build; all 44 sandbox checks; zero final obligations; matching B/G inputs. Generated evidence: results/build.json and results/validation-results.json.
- Verified: dependency audit has zero moderate/high/critical findings (remaining low findings documented in DEPENDENCIES.md).
- Verified: browser decision boundaries, input labels and mobile horizontal width against fresh output.
- Captioned evidence-viewer walkthrough: capture with `node js/capture-demo.mjs` (Node 22+, Chromium and ffmpeg). Generated and inspected: results/demo.mp4, 36 seconds, H.264, 1440×1000. Review it before publication. It has no audio and shows completed local evidence and actual calculator interactions. A human narration/live transaction capture can improve the presentation. Local-only projects require a video under Q-012; screenshots alone do not suffice.
- Published with explicit user authorization: https://github.com/creamy-ghost/standby at commit f37ad75. Anonymous README access verified. Keep the repository public through judging. Public X demo post remains required; the human attaches the video and publishes it.
- The user will submit personally. They provide their participant details, payout account and contact consent directly in the form; the agent does not need to collect or store these.
- Human submits at https://nearhackathon.com/#apply after publishing the X video post. Use the public repository URL, that X post URL and the working description below. One submission per project. No submission has been sent by this work.

Public release assets: https://github.com/creamy-ghost/standby/releases/tag/v0.1.0 .

## Demo capture outline (about 90 seconds)

1. State the problem: a primary worker misses a deadline; hiring again takes time.
2. Show the build/run command and real passing contract checks.
3. Open the generated evidence viewer. Explain standby activation/delivery and the cold retry baseline.
4. Show price and funding: 1.1 vs 1.0 replacement price; 2.1 vs 1.0 held before failure, under fixture terms.
5. Open job outcomes and checks. Show provider payment, failure refunds and no remaining obligations.
6. Change deadline-value assumptions. Show that buying standby is conditional on value and reliability, not automatically better.
7. Close with what NEAR enforces and the synthetic/local limitations.

## Draft X text

A worker misses its deadline. Hire again, or pay for a bonded backup in advance? Standby compares both on NEAR, including the premium and capital trade-off. Built at NEAR HACKATHON. @NEARProtocol #NEARHackathon https://github.com/creamy-ghost/standby

Attach results/demo.mp4 (also available as a GitHub release asset). The draft includes the approved public repository link and is below 280 characters even without URL shortening. The human publishes the post.

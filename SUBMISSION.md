# Submission preparation

Organizer rules checked November 14, 2026: https://nearhackathon.com/HACKATHON.md . Deadline: November 14 at 23:59 UTC (November 15 at 03:29 Tehran). Recheck live rules immediately before submitting.

## Working description

Standby lets a buyer purchase a bonded backup-worker option before a primary task fails. After a missed deadline, the buyer activates the agreed replacement. A NEAR contract verifies the delivered integer-system solution and settles fees, refunds and bonds. A reproducible local demo compares warm standby with ordinary cold retry on identical inputs, exposes the extra premium and advance funding, and includes a conditional deadline-value calculator. The workload is synthetic; commercial demand and physical capacity reservation remain unproved.

Suggested tracks: `swarms`, `agents`. Working name: Standby; final name and tracks require the user's selection.

## Required remaining artifacts

- Verified: pinned Rust 1.95.0 source build; all 44 sandbox checks; zero final obligations; matching B/G inputs. Generated evidence: results/build.json and results/validation-results.json.
- Verified: browser decision boundaries, input labels and mobile horizontal width against fresh output.
- Captioned evidence-viewer walkthrough: capture with `node js/capture-demo.mjs` (Node 22+, Chromium and ffmpeg). Generated and inspected: results/demo.mp4, 36 seconds, H.264, 1440×1000. Review it before publication. It has no audio and shows completed local evidence and actual calculator interactions. A human narration/live transaction capture can improve the presentation. Local-only projects require a video under Q-012; screenshots alone do not suffice.
- Public repository and public X demo post, created only with explicit user authorization. Keep the repository public through judging. No remote is configured here.
- Human-provided final name, lead name, email, team size, payout account, repository URL, demo-post URL and contact consent. Never invent these.
- Exact submission JSON shown to the user and confirmed before sending. One submission per project; preserve requestId on retries. No submission has been sent by this work.

## Demo capture outline (about 90 seconds)

1. State the problem: a primary worker misses a deadline; hiring again takes time.
2. Show the build/run command and real passing contract checks.
3. Open the generated evidence viewer. Explain standby activation/delivery and the cold retry baseline.
4. Show price and funding: 1.1 vs 1.0 replacement price; 2.1 vs 1.0 held before failure, under fixture terms.
5. Open job outcomes and checks. Show provider payment, failure refunds and no remaining obligations.
6. Change deadline-value assumptions. Show that buying standby is conditional on value and reliability, not automatically better.
7. Close with what NEAR enforces and the synthetic/local limitations.

## Draft X text

When a worker misses its deadline, should your agent hire again—or pay for a backup in advance? Built Standby at NEAR HACKATHON: bonded standby options, verified delivery and a reproducible comparison with cold retry. Fixture economics, visible trade-offs. @NEARProtocol #NEARHackathon

Attach the genuine video and add the approved public repository link. The human publishes the post.

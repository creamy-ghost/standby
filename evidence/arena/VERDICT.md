# Short verdict

**Needs revision as a product claim; the local validation itself passes.**

The updated demo fixes the two concrete lifecycle defects:

- An unaccepted primary can be expired after its deadline, refunding the buyer and enabling replacement.
- An unsold standby bond can be reclaimed after option expiry.

It also replaces the precomputed expected-hash check with a useful deterministic task: solving a
small integer linear system. Separate worker processes produce the solution, and the contract verifies
`A * x == b` exactly. Ordinary retry is implemented as a same-job, same-evaluator escrow path.

Observed local result: **41/41 checks passed**, per-job accounting conserved 22.4 NEAR of fixture
funds, repeated-call and wrong-solution cases were rejected, and final obligations/credits were zero.

But the same-task comparison does **not** show that paid standby is better. In the observed run,
ordinary cold retry recovered faster (~5.46 s vs ~7.11 s), cost less (1.0 NEAR replacement price vs
1.1 NEAR), and locked less buyer capital before failure (1.0 NEAR vs 2.1 NEAR). The task is tiny and
sandbox transaction latency dominates. Standby also wastes its premium when the primary succeeds and
leaves the job without output if the standby fails.

**Conclusion:** keep the mechanism only as a conditional lead. It is not a validated commercial
advantage. To justify it, a future test must use a workload where cold-start/solve time is large,
primary failure is frequent, and the measured recovery benefit exceeds the premium and locked capital.
No such benefit is established by this package.

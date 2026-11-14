# Standby validation

A local NEAR demo comparing paid warm standby with ordinary retry after a primary worker fails. Workers solve a small integer linear system; a pinned on-chain evaluator checks the result.

Start with [START-HERE.md](START-HERE.md) for the current verdict and agent context.

## Run

Requires Linux x86_64 and Node >=20.15. The sandbox setup downloads the pinned official binary and installs locked JS dependencies; it uses no funded accounts or API keys.

```bash
./setup-sandbox.sh
./run.sh
```

The default run replays the supplied, hash-checked WASM. Outputs go to ignored `results/`; expected final line: `ALL CHECKS PASSED` (41 checks).

For a source build, run `./build.sh` before `./run.sh`. The build script installs Rust 1.95.0 when missing. Source-to-WASM equivalence has not been independently established.

## Layout

- `contract/`: NEAR contract and locked Rust dependencies.
- `js/run.mjs`: sandbox scenarios, accounting checks and timing comparison.
- `workers/`: independent cold and warm solver processes.
- `fixtures/`: supplied WASM for local replay.
- `evidence/`: original author captures and independent review evidence.
- `results/`: generated inputs and current run results; ignored by Git.

Timings are single local observations. Prices are fixture terms. The demo does not establish market demand, physical resource reservation or production security.

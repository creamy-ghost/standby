# Sandbox dependencies

The JavaScript packages drive local NEAR sandbox tests. The generated evidence viewer has no third-party browser packages. The deployed contract artifact contains Rust dependencies, not this Node dependency tree.

`near-workspaces` is pinned to 5.0.0. Its `near-sandbox` dependency requests an old `tar` release. This repository overrides that extractor to **7.5.23**, removing the high/critical archive-extraction advisories reported against the old version. The sandbox dependency's create/extract API was checked using a benign archive.

`setup-sandbox.sh` installs with `--ignore-scripts`, downloads official sandbox 2.14.0, checks its declared SHA-256 and extracts with the system tar command. The runner selects that binary explicitly, avoiding the package's automatic binary download path.

Audit checked November 14, 2026: **0 critical, 0 high, 0 moderate**; 13 low findings propagated through the remaining elliptic/NEAR SDK dependency chain. This is not a claim that every dependency is free of defects. Audit data can change; reproduce with `cd js && npm audit`. The repository supports local fixture accounts and funds, not production funded-account operation.

Archive advisory details: https://github.com/isaacs/node-tar/security/advisories/GHSA-23hp-3jrh-7fpw . Remaining elliptic advisory: https://github.com/advisories/GHSA-848j-6mx2-7j84 .

#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p results
case "${1:-}" in
  "")
    node js/artifact.mjs verify
    export STANDBY_WASM=../contract/target/source/wasm32-unknown-unknown/release/standby_validation.wasm
    export STANDBY_FIXTURE=0
    ;;
  --fixture)
    echo '5fac1008fc9ede09fe360d2521af334f8bc467cab8b8fda85607061b740d6e07  fixtures/standby_validation.wasm' | sha256sum -c -
    export STANDBY_WASM=../fixtures/standby_validation.wasm
    export STANDBY_FIXTURE=1
    ;;
  *) echo 'Usage: ./run.sh [--fixture]' >&2; exit 2 ;;
esac
cd js
rm -f ../results/validation-results.json ../results/report.html ../results/failure.json
export NEAR_SANDBOX_BIN_PATH="${NEAR_SANDBOX_BIN_PATH:-$PWD/node_modules/near-sandbox/bin/near-sandbox}"
export NEAR_SANDBOX_BINARY_PATH="${NEAR_SANDBOX_BINARY_PATH:-$(dirname "$NEAR_SANDBOX_BIN_PATH")}"
node run.mjs
node report.mjs

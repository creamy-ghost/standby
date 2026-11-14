#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p results contract/target/wasm32-unknown-unknown/release
if [ ! -f contract/target/wasm32-unknown-unknown/release/standby_validation.wasm ]; then
  echo '5fac1008fc9ede09fe360d2521af334f8bc467cab8b8fda85607061b740d6e07  fixtures/standby_validation.wasm' | sha256sum -c -
  cp fixtures/standby_validation.wasm contract/target/wasm32-unknown-unknown/release/standby_validation.wasm
fi
cd js
export NEAR_SANDBOX_BIN_PATH="${NEAR_SANDBOX_BIN_PATH:-$PWD/node_modules/near-sandbox/bin/near-sandbox}"
export NEAR_SANDBOX_BINARY_PATH="${NEAR_SANDBOX_BINARY_PATH:-$(dirname "$NEAR_SANDBOX_BIN_PATH")}"
WASM="../contract/target/wasm32-unknown-unknown/release/standby_validation.wasm"
[ -f "$WASM" ] || { echo "Missing $WASM. Run ../build.sh first." >&2; exit 1; }
node run.mjs

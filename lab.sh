#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
node js/artifact.mjs verify
export NEAR_SANDBOX_BIN_PATH="${NEAR_SANDBOX_BIN_PATH:-$PWD/js/node_modules/near-sandbox/bin/near-sandbox}"
export NEAR_SANDBOX_BINARY_PATH="${NEAR_SANDBOX_BINARY_PATH:-$(dirname "$NEAR_SANDBOX_BIN_PATH")}"
exec node js/lab-server.mjs

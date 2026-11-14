#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/contract"
if ! command -v rustup >/dev/null 2>&1; then
  echo "rustup is required. Install from https://rustup.rs and rerun." >&2
  exit 1
fi
if ! rustup toolchain list | grep -q '^1\.95\.0'; then
  rustup toolchain install 1.95.0 --profile minimal --target wasm32-unknown-unknown
fi
RUSTFLAGS='--cfg near' rustup run 1.95.0 cargo build --release --target wasm32-unknown-unknown
sha256sum target/wasm32-unknown-unknown/release/standby_validation.wasm

#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if ! command -v rustup >/dev/null 2>&1; then
  echo "rustup is required. Install from https://rustup.rs and rerun." >&2
  exit 1
fi
STANDBY_TOOLCHAIN="${STANDBY_TOOLCHAIN:-1.95.0}"
if ! rustup toolchain list | grep -q "^${STANDBY_TOOLCHAIN}-"; then
  rustup toolchain install "$STANDBY_TOOLCHAIN" --profile minimal --target wasm32-unknown-unknown
fi
if ! rustup target list --installed --toolchain "$STANDBY_TOOLCHAIN" | grep -qx wasm32-unknown-unknown; then
  rustup target add --toolchain "$STANDBY_TOOLCHAIN" wasm32-unknown-unknown
fi
(cd contract && CARGO_TARGET_DIR=target/source RUSTFLAGS='--cfg near' rustup run "$STANDBY_TOOLCHAIN" cargo build --locked --release --target wasm32-unknown-unknown)
STANDBY_BUILD_RUSTC="$(rustup run "$STANDBY_TOOLCHAIN" rustc --version)" node js/artifact.mjs write

#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/js"
npm ci --ignore-scripts
BIN_DIR="node_modules/near-sandbox/bin"
mkdir -p "$BIN_DIR"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
URL="https://s3-us-west-1.amazonaws.com/build.nearprotocol.com/nearcore/Linux-x86_64/2.14.0/near-sandbox.tar.gz"
EXPECTED="a0ba004218b218bd74351795e7ce2eda4a2b6af5cd3e252bd5e8bfe3c8f2e691"
curl -fsSL "$URL" -o "$TMP/near-sandbox.tar.gz"
echo "$EXPECTED  $TMP/near-sandbox.tar.gz" | sha256sum -c -
tar -xzf "$TMP/near-sandbox.tar.gz" -C "$TMP"
BIN="$(find "$TMP" -type f -name near-sandbox | head -1)"
[ -n "$BIN" ] || { echo "near-sandbox binary not found" >&2; exit 1; }
cp "$BIN" "$BIN_DIR/near-sandbox"
chmod +x "$BIN_DIR/near-sandbox"
"$BIN_DIR/near-sandbox" --version

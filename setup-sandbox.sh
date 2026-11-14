#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/js"
OS="$(uname -s)"
ARCH="$(uname -m)"
if [ "$OS" != "Linux" ] || [ "$ARCH" != "x86_64" ]; then
  echo "⚠️ ERROR: Standby sandbox binary requires Linux x86_64 (detected: $OS $ARCH)." >&2
  echo "   If on macOS or Windows, please use Docker, WSL2 (x86_64), or GitHub Codespaces." >&2
  exit 1
fi
npm ci --ignore-scripts
BIN_DIR="node_modules/near-sandbox/bin"
mkdir -p "$BIN_DIR"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
URL="https://s3-us-west-1.amazonaws.com/build.nearprotocol.com/nearcore/Linux-x86_64/2.14.0/near-sandbox.tar.gz"
EXPECTED="a0ba004218b218bd74351795e7ce2eda4a2b6af5cd3e252bd5e8bfe3c8f2e691"
echo "Downloading NEAR Sandbox 2.14.0 (~90MB)..."
curl -fsSL "$URL" -o "$TMP/near-sandbox.tar.gz"
echo "$EXPECTED  $TMP/near-sandbox.tar.gz" | sha256sum -c -
tar -xzf "$TMP/near-sandbox.tar.gz" -C "$TMP"
BIN="$(find "$TMP" -type f -name near-sandbox | head -1)"
[ -n "$BIN" ] || { echo "near-sandbox binary not found" >&2; exit 1; }
cp "$BIN" "$BIN_DIR/near-sandbox"
chmod +x "$BIN_DIR/near-sandbox"
"$BIN_DIR/near-sandbox" --version

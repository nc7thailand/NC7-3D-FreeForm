#!/usr/bin/env bash
# Launch Microsoft Edge with a V8 heap cap for manual crash-reproduction testing on macOS/Linux.
# Usage: ./scripts/launch-edge-heap-test.sh [4096|8192] [url]

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HEAP_MB="${1:-4096}"
APP_URL="${2:-http://localhost:5173/}"

EDGE=""
if [[ "$OSTYPE" == darwin* ]]; then
  EDGE="/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
elif command -v microsoft-edge >/dev/null 2>&1; then
  EDGE="microsoft-edge"
elif command -v msedge >/dev/null 2>&1; then
  EDGE="msedge"
fi

if [[ -z "$EDGE" || ! -x "$EDGE" ]]; then
  echo "Microsoft Edge not found. Install Edge or use WebView2 on Windows (host/webview2)." >&2
  exit 1
fi

echo ""
echo "NC7 Edge heap test"
echo "=================="
echo "Heap cap: ${HEAP_MB} MB"
echo "URL:      ${APP_URL}"
echo ""

exec "$EDGE" \
  --js-flags="--max-old-space-size=${HEAP_MB}" \
  --new-window \
  "$APP_URL"

#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$HOME/.cargo/bin:$PATH"

TAURI_BIN="$ROOT_DIR/node_modules/.bin/tauri"
if [[ ! -x "$TAURI_BIN" ]]; then
  echo "tauri CLI not found at $TAURI_BIN. Run npm install." >&2
  exit 1
fi

if ! command -v flamegraph >/dev/null 2>&1; then
  echo "flamegraph not found in PATH. Expected in $HOME/.cargo/bin." >&2
  exit 1
fi

"$TAURI_BIN" dev --config "$ROOT_DIR/app/backend/tauri.conf.json" --release --features dhat-heap -- --locked &
TAURI_PID=$!

cleanup() {
  if kill -0 "$TAURI_PID" 2>/dev/null; then
    kill "$TAURI_PID" 2>/dev/null || true
  fi
}
trap cleanup INT TERM EXIT

APP_PID=""
for _ in {1..120}; do
  APP_PID="$(pgrep -x discuss-companion | tail -n 1 || true)"
  if [[ -n "$APP_PID" ]]; then
    break
  fi
  sleep 0.5
done

if [[ -z "$APP_PID" ]]; then
  echo "Timed out waiting for discuss-companion to start." >&2
  exit 1
fi

echo "Profiling discuss-companion (pid $APP_PID)..."
flamegraph --pid "$APP_PID" --output "$ROOT_DIR/app/profiling/flamegraph.svg"

#!/usr/bin/env bash
# Dev-mode launcher for Skating Editor.
#
# Runs BOTH processes dev testing needs:
#   1. the worker  (node scripts/worker.js) — actually processes upload jobs
#   2. the web app  (Next.js dev server, port 3002)
#
# Usage:   bash scripts/dev-test.sh     (works even from non-interactive shells)
# Stop:    Ctrl+C (stops both)

set -u

cd "$(dirname "$0")/.."

# Node here is installed via nvm, which is normally loaded from ~/.bashrc.
# `bash script.sh` runs as a NON-interactive shell and never sources .bashrc,
# so source nvm ourselves (and fall back to the newest installed version).
if ! command -v node >/dev/null 2>&1 && [ -s "$HOME/.nvm/nvm.sh" ]; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh"
fi
if ! command -v node >/dev/null 2>&1; then
  LATEST="$(ls -1 "$HOME/.nvm/versions/node" 2>/dev/null | tail -1)"
  [ -n "$LATEST" ] && export PATH="$HOME/.nvm/versions/node/$LATEST/bin:$PATH"
fi
if ! command -v node >/dev/null 2>&1; then
  echo "!! node not found — install Node.js (e.g. via nvm) and try again." >&2
  exit 1
fi

PORT="${PORT:-3002}"
PIDS=()

cleanup() {
  printf "\n==> Stopping…\n"
  for pid in "${PIDS[@]:-}"; do kill "$pid" 2>/dev/null; done
  wait 2>/dev/null
}
trap cleanup EXIT INT TERM

echo "==> Running with node $(node -v)…"
echo "==> Starting worker (scripts/worker.js)…"
node scripts/worker.js &
PIDS+=($!)

echo "==> Starting Next.js dev server on :$PORT…"
npx next dev -p "$PORT" &
PIDS+=($!)

wait
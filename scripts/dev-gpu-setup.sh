#!/usr/bin/env bash
# Dev-mode GPU (VAAPI) setup for Skating Editor.
#
#   - Adds your user to the video + render groups (needed to open /dev/dri/*)
#   - Installs libva-utils (vainfo) if missing
#   - Verifies VAAPI actually works (via a fresh login session)
#
# Usage:   bash scripts/dev-gpu-setup.sh
# Note:    group changes only apply to NEW sessions — log out/in afterwards
#          (or run: sudo reboot), then re-run this or just check with: vainfo

set -u

GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; RED=$'\033[0;31m'; NC=$'\033[0m'
say()  { printf "%b==>%b %s\n" "$GREEN" "$NC" "$*"; }
warn() { printf "%b!!%b %s\n" "$YELLOW" "$NC" "$*"; }
die()  { printf "%b!!%b %s\n" "$RED" "$NC" "$*"; exit 1; }

[ "$(id -u)" -eq 0 ] && die "Run as your normal user, not root (the script uses sudo when needed)."

ME="$(whoami)"

# 0. Sanity: is there even an iGPU?
if [ ! -e /dev/dri/card0 ]; then
  warn "/dev/dri/card0 not found — no Intel iGPU on this machine, GPU path won't work."
fi

# 1. Add user to video + render groups (only if missing)
NEED=""
for g in video render; do
  id -nG | tr ' ' '\n' | grep -qx "$g" || NEED="$NEED $g"
done
if [ -n "$NEED" ]; then
  say "Adding $ME to groups:$NEED (sudo)"
  sudo usermod -aG $NEED "$ME" || die "usermod failed — check your sudo access."
else
  say "Already in video/render groups."
fi

# 2. Install vainfo (libva-utils) if missing
if ! command -v vainfo >/dev/null 2>&1; then
  say "Installing libva-utils (provides vainfo)… (sudo)"
  sudo apt-get update -qq && sudo apt-get install -y libva-utils \
    || warn "apt install failed — vainfo unavailable (not strictly required)."
else
  say "vainfo already installed."
fi

# 3. Verify via a fresh login session (picks up the new groups without re-login)
if sudo -n -u "$ME" -i true 2>/dev/null; then
  if sudo -n -u "$ME" -i bash -c 'vainfo >/dev/null 2>&1'; then
    say "VAAPI verified — GPU path ready."
    sudo -n -u "$ME" -i bash -c 'vainfo 2>/dev/null | grep -E "Driver version|VAProfileH264|VAProfileHEVC" | head -6'
  else
    warn "Groups updated, but VAAPI not verified yet (see re-login note below)."
  fi
else
  warn "Skipping auto-verify (sudo needs a password in this context). See note below."
fi

if [ "$(id -nG | tr ' ' '\n' | grep -cE '^(video|render)$')" -lt 2 ]; then
  echo
  warn "Group changes only apply to NEW login sessions."
  echo "   1) Log out and back in (or run:  sudo reboot )"
  echo "   2) Verify with:  vainfo"
  echo "   3) Start dev mode:  bash scripts/dev-test.sh"
fi
echo
say "Done. Start dev mode with:  bash scripts/dev-test.sh"
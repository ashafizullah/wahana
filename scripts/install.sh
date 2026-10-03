#!/usr/bin/env bash
# Build Wahana from source: installs Rust and Bun when missing, then runs
# `bun run tauri build`.
#
# Usage, from a checkout:   ./scripts/install.sh
# Usage, standalone:        bash -c "$(curl -fsSL https://raw.githubusercontent.com/ashafizullah/wahana/main/scripts/install.sh)"
#
# Standalone runs clone the repository into $WAHANA_DIR (default ~/wahana),
# or update it with a fast-forward pull when it is already there.
set -euo pipefail

# Minimum Rust version, kept in sync with `rust-version` in src-tauri/Cargo.toml.
MIN_RUST="1.90.0"
REPO_URL="https://github.com/ashafizullah/wahana.git"
WAHANA_DIR="${WAHANA_DIR:-$HOME/wahana}"

info() { printf '\033[1;34m==>\033[0m %s\n' "$1"; }
fail() { printf '\033[1;31merror:\033[0m %s\n' "$1" >&2; exit 1; }

[[ "$(uname -s)" == "Darwin" ]] || fail "Wahana is a macOS app; run this on macOS."
command -v curl >/dev/null || fail "curl is required."
xcode-select -p >/dev/null 2>&1 ||
  fail "Xcode Command Line Tools are required. Install them with: xcode-select --install"

# --- Source -----------------------------------------------------------------
# Run from the repository root: the checkout this script lives in, or a fresh
# clone when it was fetched with curl (BASH_SOURCE is empty then).
script_dir=""
if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi
if [[ -n "$script_dir" && -f "$script_dir/../src-tauri/tauri.conf.json" ]]; then
  cd "$script_dir/.."
elif [[ -d "$WAHANA_DIR/.git" ]]; then
  info "Updating existing checkout in $WAHANA_DIR..."
  git -C "$WAHANA_DIR" pull --ff-only
  cd "$WAHANA_DIR"
elif [[ -e "$WAHANA_DIR" ]]; then
  fail "$WAHANA_DIR exists but is not a git checkout; set WAHANA_DIR to another path."
else
  info "Cloning Wahana into $WAHANA_DIR..."
  git clone --depth 1 "$REPO_URL" "$WAHANA_DIR"
  cd "$WAHANA_DIR"
fi

# --- Rust -------------------------------------------------------------------
# A previous rustup install may not be on PATH in this shell yet.
[[ -f "$HOME/.cargo/env" ]] && source "$HOME/.cargo/env"

if command -v cargo >/dev/null && command -v rustc >/dev/null; then
  info "Rust found: $(rustc --version)"
  current="$(rustc --version | awk '{print $2}')"
  if [[ "$(printf '%s\n%s\n' "$MIN_RUST" "$current" | sort -V | head -n1)" != "$MIN_RUST" ]]; then
    command -v rustup >/dev/null || fail "Rust $current is older than $MIN_RUST; please upgrade it."
    info "Rust $current is older than $MIN_RUST, updating the stable toolchain..."
    rustup update stable
  fi
else
  info "Rust not found, installing via rustup..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  source "$HOME/.cargo/env"
  info "Installed $(rustc --version)"
fi

# --- Bun --------------------------------------------------------------------
export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$BUN_INSTALL/bin:$PATH"

if command -v bun >/dev/null; then
  info "Bun found: $(bun --version)"
else
  info "Bun not found, installing..."
  curl -fsSL https://bun.sh/install | bash
  info "Installed Bun $(bun --version)"
fi

# --- Build ------------------------------------------------------------------
BUNDLE_DIR="$PWD/src-tauri/target/release/bundle"

# Eject disk images left mounted by an earlier build (or an opened installer
# named "Wahana"); a mounted image makes the DMG step fail with
# "hdiutil: couldn't unmount ... Resource busy".
eject_stale_dmgs() {
  local dev vol
  for dev in $(hdiutil info | awk -v root="$PWD/src-tauri/target/" '
    /^image-path/ { sub(/^image-path[ \t]*:[ \t]*/, ""); hit = (index($0, root) == 1); next }
    hit && /^\/dev\/disk[0-9]+/ { d = $1; sub(/s[0-9]+$/, "", d); print d; hit = 0 }'); do
    hdiutil detach "$dev" -force -quiet || true
  done
  for vol in /Volumes/Wahana*; do
    [[ -d "$vol" ]] && { hdiutil detach "$vol" -force -quiet || true; }
  done
  rm -f "$BUNDLE_DIR"/macos/rw.*.dmg
}

info "Installing frontend dependencies..."
bun install

eject_stale_dmgs
info "Building Wahana (bun run tauri build)..."
if ! bun run tauri build; then
  # Tauri's bundled create-dmg script only retries `hdiutil detach` on exit
  # code 16, but a transient "Resource busy" (Finder/Spotlight touching the
  # fresh volume) exits with 1, so the DMG step fails intermittently. The app
  # itself is already built at this point; retry just the DMG step.
  [[ -d "$BUNDLE_DIR/macos/Wahana.app" ]] || fail "Build failed."
  for attempt in 1 2 3; do
    info "DMG bundling failed, retrying ($attempt/3)..."
    eject_stale_dmgs
    sleep 2
    bun run tauri build --bundles dmg && break
    (( attempt == 3 )) && fail "DMG bundling failed after 3 retries."
  done
fi
eject_stale_dmgs

info "Done. Build artifacts:"
ls -d "$BUNDLE_DIR"/macos/*.app "$BUNDLE_DIR"/dmg/*.dmg 2>/dev/null || true

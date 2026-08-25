#!/usr/bin/env bash
# codegraph installer — clone it, resolve its dependencies, and optionally run the
# viewer as a systemd --user service.
#
# Safe to pipe from curl on a machine that has never seen this repo: if the script
# cannot find a checkout around itself it clones one, so the same file bootstraps a
# new machine and re-runs inside an existing clone.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/bk-bf/codegraph/master/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/bk-bf/codegraph/master/install.sh | bash -s -- --enable-units
#   ./install.sh                              clone if needed + install dependencies
#   ./install.sh --with-units                 …and write the systemd --user unit
#   ./install.sh --enable-units               …and enable --now it
#   ./install.sh --no-deps                    skip `pnpm install`
#   ./install.sh --port N                     serve on N instead of 5185
#   ./install.sh --project NAME               graph built on first start
#                                             (default: first entry in projects.json)
#   ./install.sh --bind ADDR                  listen on ADDR instead of localhost
#   ./install.sh --proxied-host NAME          accept requests for NAME (needed when
#                                             a reverse proxy fronts the viewer;
#                                             Vite rejects unknown Host headers)
#   ./install.sh --uninstall [--yes]          remove what this script installed
#
# Environment:
#   CODEGRAPH_DIR   where to clone       ~/Projects/codegraph
#   CODEGRAPH_REPO  what to clone        git@github.com:bk-bf/codegraph.git
#
# Nothing is enabled or started unless you ask. The unit is an inert file until
# then, so --with-units is safe on a machine you have not decided about yet.
set -euo pipefail

UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT=codegraph.service
DEFAULT_PORT=5185
MIN_NODE=20
CLONE_DIR="${CODEGRAPH_DIR:-$HOME/Projects/codegraph}"
CLONE_URL="${CODEGRAPH_REPO:-git@github.com:bk-bf/codegraph.git}"

WITH_UNITS=0
DO_ENABLE=0
INSTALLED=1
DO_UNINSTALL=0
DO_DEPS=1
YES=0
PORT=""
PROJECT=""
BIND=""
PROXIED_HOST=""

say() { printf '→ %s\n' "$*" >&2; }
die() { printf 'codegraph install: %s\n' "$*" >&2; exit 1; }
esc() { printf '%s' "$1" | sed -e 's/[\\&|]/\\&/g'; }

# Held here rather than sed'd out of the header: piped from curl there is no file to
# read back, and a line range silently goes stale the moment a line is added above it.
usage() {
  cat <<'USAGE'
codegraph installer — clone it, resolve its dependencies, and optionally run the
viewer as a systemd --user service.

  curl -fsSL https://raw.githubusercontent.com/bk-bf/codegraph/master/install.sh | bash
  curl -fsSL .../install.sh | bash -s -- --enable-units

  --with-units          write the systemd --user unit (written, not started)
  --enable-units        …and enable --now it
  --no-deps             skip `pnpm install`
  --port N              serve on N instead of 5185
  --project NAME        graph built on first start
  --bind ADDR           listen on ADDR instead of localhost
  --proxied-host NAME   accept requests for NAME (a reverse proxy fronts the viewer)
  --uninstall [--yes]   remove what this script installed

  CODEGRAPH_DIR   where to clone   ~/Projects/codegraph
  CODEGRAPH_REPO  what to clone    git@github.com:bk-bf/codegraph.git
USAGE
}

# --- where the checkout is ----------------------------------------------------
# A checkout is identifiable, so look rather than assume: piped from curl,
# BASH_SOURCE is a pipe and its directory means nothing.
is_checkout() { [ -f "$1/bin/codegraph.mjs" ] && [ -f "$1/package.json" ]; }

resolve_src() {
  local here
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || true)"
  if [ -n "$here" ] && is_checkout "$here"; then SRC="$here"; return 0; fi
  if is_checkout "$PWD"; then SRC="$PWD"; return 0; fi
  if is_checkout "$CLONE_DIR"; then
    SRC="$CLONE_DIR"
    say "found an existing checkout at $SRC"
    return 0
  fi
  command -v git >/dev/null 2>&1 || die "missing dependency: git"
  say "cloning $CLONE_URL -> $CLONE_DIR"
  mkdir -p "$(dirname "$CLONE_DIR")"
  git clone --quiet "$CLONE_URL" "$CLONE_DIR" \
    || die "clone failed. For HTTPS instead: CODEGRAPH_REPO=https://github.com/bk-bf/codegraph.git"
  SRC="$CLONE_DIR"
}

# --- dependencies -------------------------------------------------------------
# The reason this script exists at all. svelte-check reads the tsconfig SvelteKit
# generates, which names the `node` type library, so a checkout without its
# dependencies fails to typecheck for a reason that looks nothing like the cause.
check_node() {
  command -v node >/dev/null 2>&1 || die "missing dependency: node (>= $MIN_NODE)"
  local major
  major=$(node -p 'process.versions.node.split(".")[0]')
  [ "$major" -ge "$MIN_NODE" ] || die "node $major is too old — needs >= $MIN_NODE"
  say "node $(node -v)"
}

ensure_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then
    say "pnpm $(pnpm --version)"
    return 0
  fi
  # corepack ships with node and is the supported way to get pnpm without a global
  # install, so try it before telling anyone to go and install something.
  if command -v corepack >/dev/null 2>&1; then
    say "pnpm not found — enabling it through corepack"
    corepack enable pnpm >/dev/null 2>&1 || true
  fi
  command -v pnpm >/dev/null 2>&1 \
    || die "missing dependency: pnpm. Install it with 'corepack enable pnpm' or see https://pnpm.io/installation"
  say "pnpm $(pnpm --version)"
}

install_deps() {
  check_node
  ensure_pnpm
  say "installing dependencies in $SRC"
  ( cd "$SRC" && pnpm install ) || die "pnpm install failed"
  # svelte-kit sync writes .svelte-kit/tsconfig.json, which the repo tsconfig extends.
  # pnpm's prepare hook normally does this; run it plainly so a missing hook cannot
  # leave the checkout unable to typecheck.
  ( cd "$SRC" && pnpm exec svelte-kit sync ) >/dev/null 2>&1 \
    || say "warning: svelte-kit sync failed — 'pnpm check' may not resolve its tsconfig"
}

# --- the unit -----------------------------------------------------------------
# The project whose graph gets built on first start, so the viewer is not empty.
# Taken from projects.json rather than hardcoded — this repo is used against
# whatever is checked out next to it.
default_project() {
  local p
  p=$(sed -n 's/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$SRC/projects.json" 2>/dev/null | head -1)
  printf '%s' "${p:-codegraph}"
}

install_units() {
  if ! command -v systemctl >/dev/null 2>&1; then
    say "no systemctl here — skipping units"
    INSTALLED=0
    return 0
  fi
  local node
  node=$(command -v node) || die "missing dependency: node"
  [ -f "$SRC/node_modules/vite/bin/vite.js" ] || \
    say "warning: node_modules/vite is missing — re-run without --no-deps before starting the unit"

  # Vite binds localhost and rejects unknown Host headers, so a proxied deployment has to
  # name both: the address the proxy can reach, and the hostname it forwards.
  local bindarg="" envlines=""
  [ -n "$BIND" ] && bindarg=" --host $BIND"
  [ -n "$PROXIED_HOST" ] && envlines="Environment=CODEGRAPH_ALLOWED_HOST=$PROXIED_HOST"

  mkdir -p "$UNIT_DIR" "$UNIT_DIR/$UNIT.d"
  sed -e "s|@BINDARG@|$(esc "$bindarg")|g" \
      -e "s|@ENVLINES@|$(esc "$envlines")|g" \
      -e "s|@REPO@|$(esc "$SRC")|g" \
      -e "s|@NODE@|$(esc "$node")|g" \
      -e "s|@PORT@|$(esc "$PORT")|g" \
      -e "s|@PROJECT@|$(esc "$PROJECT")|g" \
      "$SRC/deploy/$UNIT" | grep -v '^@ENVLINES@$' > "$UNIT_DIR/$UNIT"
  say "wrote $UNIT_DIR/$UNIT"
  cp "$SRC/deploy/50-background.conf" "$UNIT_DIR/$UNIT.d/50-background.conf"
  say "wrote $UNIT_DIR/$UNIT.d/50-background.conf"
  systemctl --user daemon-reload >/dev/null 2>&1 || true
}

enable_units() {
  command -v systemctl >/dev/null 2>&1 || { say "no systemctl here — nothing to enable"; return 0; }
  systemctl --user enable --now "$UNIT"
  say "enabled $UNIT on port $PORT"
}

uninstall() {
  if [ "$YES" != 1 ]; then
    # Piped from curl, stdin is the script itself — there is nobody to answer.
    [ -t 0 ] || die "--uninstall needs --yes when this is not run interactively"
    printf 'Remove %s and its drop-in? [y/N] ' "$UNIT_DIR/$UNIT"
    read -r a; case "$a" in y|Y|yes|YES) ;; *) echo "aborted."; exit 1 ;; esac
  fi
  if command -v systemctl >/dev/null 2>&1; then
    systemctl --user disable --now "$UNIT" >/dev/null 2>&1 || true
  fi
  rm -f "$UNIT_DIR/$UNIT"
  rm -rf "$UNIT_DIR/$UNIT.d"
  say "removed $UNIT"
  command -v systemctl >/dev/null 2>&1 && systemctl --user daemon-reload >/dev/null 2>&1 || true
}

while [ $# -gt 0 ]; do
  case "$1" in
    --with-units)   WITH_UNITS=1 ;;
    --enable-units) WITH_UNITS=1; DO_ENABLE=1 ;;
    --no-deps)      DO_DEPS=0 ;;
    --port)         shift; [ $# -gt 0 ] || die "--port needs a number"
                    case "$1" in ''|*[!0-9]*) die "--port must be a number: $1" ;; esac
                    PORT="$1" ;;
    --project)      shift; [ $# -gt 0 ] || die "--project needs a name"; PROJECT="$1" ;;
    --bind)         shift; [ $# -gt 0 ] || die "--bind needs an address"; BIND="$1" ;;
    --proxied-host) shift; [ $# -gt 0 ] || die "--proxied-host needs a name"; PROXIED_HOST="$1" ;;
    --uninstall)    DO_UNINSTALL=1 ;;
    --yes|-y)       YES=1 ;;
    -h|--help)      usage; exit 0 ;;
    *)              die "unknown argument: $1 (try --help)" ;;
  esac
  shift
done

if [ "$DO_UNINSTALL" = 1 ]; then uninstall; exit 0; fi

resolve_src
[ "$DO_DEPS" = 1 ] && install_deps

PORT="${PORT:-$DEFAULT_PORT}"
PROJECT="${PROJECT:-$(default_project)}"

[ "$WITH_UNITS" = 1 ] && install_units
[ "$WITH_UNITS" = 1 ] && [ "$DO_ENABLE" = 1 ] && enable_units

echo
echo "done. codegraph is at $SRC"
if [ "$WITH_UNITS" != 1 ]; then
  echo "  run the viewer:     cd $SRC && pnpm dev"
  echo "  install the unit:   $SRC/install.sh --enable-units"
elif [ "$INSTALLED" != 1 ]; then
  echo "  no systemd here — run it with: cd $SRC && pnpm dev"
elif [ "$DO_ENABLE" = 1 ]; then
  echo "  viewer on http://localhost:$PORT"
  echo "  to survive logout:  loginctl enable-linger \$USER"
else
  echo "  the unit is installed but not started:"
  echo "    systemctl --user enable --now $UNIT"
fi
echo "  onboard a project:  $SRC/bin/codegraph.mjs onboard /path/to/repo"
exit 0

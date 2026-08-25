#!/usr/bin/env bash
# codegraph installer — run the viewer as a systemd --user service from
# wherever this repo happens to be cloned.
#
# There is nothing to build here that `pnpm install` doesn't already do, so what
# this script exists for is the one piece that used to be kept by hand: a unit
# file with this checkout's path, node, port and default project filled in.
#
# Usage:
#   ./install.sh --with-units                 write the systemd --user unit
#                                             (written, not started)
#   ./install.sh --enable-units               …and enable --now it
#   ./install.sh --port N                     serve on N instead of 5185
#   ./install.sh --project NAME               graph built on first start
#                                             (default: first entry in projects.json)
#   ./install.sh --bind ADDR                  listen on ADDR instead of localhost
#   ./install.sh --proxied-host NAME          accept requests for NAME (needed when
#                                             a reverse proxy fronts the viewer;
#                                             Vite rejects unknown Host headers)
#   ./install.sh --uninstall [--yes]          remove what this script installed
#
# Nothing is enabled or started unless you ask. The unit is an inert file until
# then, so --with-units is safe on a machine you have not decided about yet.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT=codegraph.service
DEFAULT_PORT=5185

WITH_UNITS=0
DO_ENABLE=0
INSTALLED=1
DO_UNINSTALL=0
YES=0
PORT=""
PROJECT=""
BIND=""
PROXIED_HOST=""

say() { printf '→ %s\n' "$*" >&2; }
die() { printf 'codegraph install: %s\n' "$*" >&2; exit 1; }
esc() { printf '%s' "$1" | sed -e 's/[\\&|]/\\&/g'; }

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
    say "warning: node_modules/vite is missing — run 'pnpm install' before starting the unit"

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
    --port)         shift; [ $# -gt 0 ] || die "--port needs a number"
                    case "$1" in ''|*[!0-9]*) die "--port must be a number: $1" ;; esac
                    PORT="$1" ;;
    --project)      shift; [ $# -gt 0 ] || die "--project needs a name"; PROJECT="$1" ;;
    --bind)         shift; [ $# -gt 0 ] || die "--bind needs an address"; BIND="$1" ;;
    --proxied-host) shift; [ $# -gt 0 ] || die "--proxied-host needs a name"; PROXIED_HOST="$1" ;;
    --uninstall)    DO_UNINSTALL=1 ;;
    --yes|-y)       YES=1 ;;
    -h|--help)      sed -n '2,23p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)              die "unknown argument: $1 (try --help)" ;;
  esac
  shift
done

if [ "$DO_UNINSTALL" = 1 ]; then uninstall; exit 0; fi
[ "$WITH_UNITS" = 1 ] || { sed -n '2,23p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0; }

PORT="${PORT:-$DEFAULT_PORT}"
PROJECT="${PROJECT:-$(default_project)}"

install_units
[ "$DO_ENABLE" = 1 ] && enable_units

echo
if [ "$INSTALLED" != 1 ]; then
  echo "done. Nothing was written — this machine has no systemd."
elif [ "$DO_ENABLE" = 1 ]; then
  echo "done. Viewer on http://localhost:$PORT"
  echo "  to survive logout:  loginctl enable-linger \$USER"
else
  echo "done. The unit is installed but not started:"
  echo "    systemctl --user enable --now $UNIT"
fi
exit 0

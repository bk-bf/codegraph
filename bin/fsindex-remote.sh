#!/usr/bin/env bash
# Index a remote host's filesystem into data/<name>.json.
# The indexer (fsindex.mjs) is self-contained (node builtins only), so we just
# ship it + the host's config to /tmp on the remote, run node there, and pull the
# graph back. Requires node on the remote and ssh access.
#
#   bin/fsindex-remote.sh <ssh-host> <fsproject-name>
#   e.g. bin/fsindex-remote.sh ubuntu ubuntuserver
set -euo pipefail

HOST="${1:?usage: fsindex-remote.sh <ssh-host> <fsproject-name>}"
NAME="${2:?usage: fsindex-remote.sh <ssh-host> <fsproject-name>}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
CFG="$REPO/fsprojects/$NAME/codegraph.config.json"
OUT="$REPO/data/$NAME.json"
REMOTE_DIR="/tmp/codegraph-fsindex"

[ -f "$CFG" ] || { echo "no config: $CFG" >&2; exit 1; }
mkdir -p "$REPO/data"

ssh "$HOST" "mkdir -p $REMOTE_DIR"
scp -q "$REPO/src/lib/core/fsindex.mjs" "$HOST:$REMOTE_DIR/fsindex.mjs"
scp -q "$CFG" "$HOST:$REMOTE_DIR/config.json"
ssh "$HOST" "CG_CONFIG=$REMOTE_DIR/config.json CG_OUT=$REMOTE_DIR/out.json node $REMOTE_DIR/fsindex.mjs"
scp -q "$HOST:$REMOTE_DIR/out.json" "$OUT"
echo "→ $OUT"

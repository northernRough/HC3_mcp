#!/bin/bash
# Update the HC3 MCP server on a Pi deployed via git clone.
# Run this from anywhere; the script cd's to /opt/hc3-mcp/src.
#
#   pi-update.sh           pull; rebuild and restart ONLY if something changed
#   pi-update.sh --force   pull, rebuild and restart regardless
#
# hc3-mcp-update.timer runs this hourly. Until 4.34.2 every run did npm ci,
# a full compile and a restart even when `git pull` brought nothing: ~30 s of
# CPU and a dropped MCP session every hour, for no change. Now an unchanged
# pull is a no-op, decided by comparing HEAD with the commit the running build
# was made from (out/.deployed-commit, written only after a successful
# rebuild and restart). A missing marker, or a build from a different commit,
# still rebuilds, so a half-finished earlier deploy is not mistaken for current.
set -euo pipefail

FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

cd /opt/hc3-mcp/src
MARKER=out/.deployed-commit
# Every git call runs as the checkout's owner: as root, git refuses it
# ("dubious ownership").
G() { sudo -u hc3mcp git "$@"; }

before=$(G rev-parse HEAD)
G pull -q
after=$(G rev-parse HEAD)
built=$(cat "$MARKER" 2>/dev/null || true)

if [ "$FORCE" = 0 ] && [ "$before" = "$after" ] && [ "$built" = "$after" ]; then
  # Nothing to deploy. Still make sure the server is up: a stopped service
  # would otherwise stay stopped until the next commit happened to land.
  if ! systemctl is-active --quiet hc3-mcp; then
    echo "no change ($(G log --oneline -1)), but hc3-mcp was not running: starting it"
    sudo systemctl start hc3-mcp
  else
    echo "no change: $(G log --oneline -1); build current, not restarting"
  fi
  exit 0
fi

if [ "$FORCE" = 1 ]; then
  echo "forced rebuild at $(G log --oneline -1)"
elif [ "$before" != "$after" ]; then
  echo "updating: ${before:0:7} -> ${after:0:7}"
  G log --oneline "${before}..${after}" | sed 's/^/  /'
else
  echo "rebuilding: running build is from '${built:-unknown}', HEAD is ${after:0:7}"
fi

sudo -u hc3mcp npm ci
sudo -u hc3mcp npm run compile
sudo systemctl restart hc3-mcp
echo "$after" | sudo -u hc3mcp tee "$MARKER" >/dev/null

# Brief startup smoke check — show the most recent journal lines so you can see
# the "running on HTTP" and "HC3 reachable" banner.
sleep 1
sudo journalctl -u hc3-mcp -n 5 --no-pager

# What is actually deployed.
#
# The server reports its version from package.json, so a compile that failed
# or was skipped leaves it announcing a new version while running old code —
# "reports success, did not do the thing", which is the failure this project
# guards against everywhere else. Print the commit and a build hash so drift
# is visible here rather than discovered later against a live gateway.
#
# Compare these against the same values in a checkout of the same commit:
#   git log --oneline -1 && md5sum out/mcp/patch.js
echo
echo "deployed commit: $(sudo -u hc3mcp git -C /opt/hc3-mcp/src log --oneline -1)"
echo "working tree   : $(sudo -u hc3mcp git -C /opt/hc3-mcp/src status --porcelain | wc -l) modified file(s) (expect 0)"
echo "build hash     : $(md5sum /opt/hc3-mcp/src/out/mcp/patch.js 2>/dev/null | cut -d' ' -f1) (out/mcp/patch.js)"

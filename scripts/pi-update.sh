#!/bin/bash
# Update the HC3 MCP server on a Pi deployed via git clone.
# Run this from anywhere; the script cd's to /opt/hc3-mcp/src.
set -euo pipefail

cd /opt/hc3-mcp/src
sudo -u hc3mcp git pull
sudo -u hc3mcp npm ci
sudo -u hc3mcp npm run compile
sudo systemctl restart hc3-mcp

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

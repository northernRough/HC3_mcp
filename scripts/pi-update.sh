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

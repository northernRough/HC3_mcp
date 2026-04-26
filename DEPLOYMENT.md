# Deploying HC3 MCP Server on a Raspberry Pi 5 with Cloudflare Tunnel

Step-by-step guide for running this MCP server as a long-lived HTTP service on a Pi, reachable from Anthropic's cloud (so it can be used from the Claude mobile app) without exposing any router ports or managing TLS certificates.

This guide assumes:
- A Raspberry Pi 5 with Pi OS 64-bit (Bookworm or later) freshly installed and updated.
- Network access from the Pi to your HC3 (e.g. both on the same LAN).
- A free Cloudflare account with a domain you control.
- An npm account on the device that can install global packages, OR you'll clone this repo locally and run from `out/mcp/...`.

If you only want local desktop use (Claude Desktop / Claude Code on your Mac), **you don't need any of this**. The default stdio transport is sufficient there. This guide is specifically for the always-on HTTP path.

---

## 1 — Pi base setup (10 minutes)

### Update and install prerequisites

```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y curl git
```

### Install Node.js 20 LTS

The package version Pi OS ships is too old. Use NodeSource's ARM64 build:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version   # should print v20.x
npm --version
```

### Create a dedicated service user (no shell, no sudo)

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin hc3mcp
```

### Create config directory

```bash
sudo mkdir -p /etc/hc3-mcp
sudo chown root:hc3mcp /etc/hc3-mcp
sudo chmod 0750 /etc/hc3-mcp
```

---

## 2 — Install the server (5 minutes)

You have two options. Pick one.

### Option A — install from npm (simpler)

```bash
sudo npm install -g @northernrough/hc3-mcp-server
which hc3-mcp-server   # should print /usr/bin/hc3-mcp-server or similar
```

The systemd unit below assumes Option A (path `/usr/bin/hc3-mcp-server`). If `which` prints a different path, substitute it in the unit file.

### Option B — clone and build from source (if you want the bleeding edge)

```bash
sudo mkdir -p /opt/hc3-mcp
sudo chown $USER:hc3mcp /opt/hc3-mcp
cd /opt/hc3-mcp
git clone https://github.com/northernRough/HC3_mcp.git src
cd src
npm install
npm run compile
sudo chown -R hc3mcp:hc3mcp /opt/hc3-mcp
```

The systemd unit's `ExecStart` would then be `/usr/bin/node /opt/hc3-mcp/src/out/mcp/hc3-mcp-server.js`.

---

## 3 — Configure credentials and the bearer token (5 minutes)

Generate a strong bearer token. Save it — you'll need it again at the Cloudflare step and again at claude.ai.

```bash
openssl rand -hex 32
```

That prints a 64-character hex string. Copy it.

Create the env file:

```bash
sudo tee /etc/hc3-mcp/.env > /dev/null <<EOF
# HC3 connection
FIBARO_HOST=10.0.1.3
FIBARO_USERNAME=your_admin_user
FIBARO_PASSWORD=your_admin_password
FIBARO_PORT=80

# Transport
MCP_TRANSPORT=http
MCP_HTTP_HOST=127.0.0.1
MCP_HTTP_PORT=3000
MCP_HTTP_TOKEN=<paste the openssl rand output here>
EOF

sudo chown root:hc3mcp /etc/hc3-mcp/.env
sudo chmod 0640 /etc/hc3-mcp/.env
```

`MCP_HTTP_HOST=127.0.0.1` is important: the server binds only to localhost, so the only way in is via the `cloudflared` daemon running on the same machine. Port 3000 is never exposed on the LAN.

---

## 4 — Install the systemd unit (5 minutes)

```bash
sudo tee /etc/systemd/system/hc3-mcp.service > /dev/null <<'EOF'
[Unit]
Description=HC3 MCP Server (HTTP transport)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=hc3mcp
Group=hc3mcp
EnvironmentFile=/etc/hc3-mcp/.env
ExecStart=/usr/bin/hc3-mcp-server
Restart=on-failure
RestartSec=5

# Sandboxing
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
PrivateDevices=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
LockPersonality=true
RestrictRealtime=true

# Logging
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now hc3-mcp
```

If you used Option B (build from source), change the `ExecStart` line to `/usr/bin/node /opt/hc3-mcp/src/out/mcp/hc3-mcp-server.js`.

### Verify it's running

```bash
sudo systemctl status hc3-mcp
journalctl -u hc3-mcp -n 50
```

You should see in the logs:

```
Fibaro HC3 MCP server running on HTTP at http://127.0.0.1:3000/mcp (bearer auth required)
HC3 reachable at 10.0.1.3:80 — softVersion 5.202.54, serial HC3-XXXXXX
```

If the second line says **FAILED**, your HC3 credentials or network are wrong. Fix the `.env` and `sudo systemctl restart hc3-mcp`.

### Smoke test from the Pi

```bash
TOKEN=$(sudo grep ^MCP_HTTP_TOKEN= /etc/hc3-mcp/.env | cut -d= -f2)
curl -s http://127.0.0.1:3000/healthz
curl -s -X POST http://127.0.0.1:3000/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | head -c 200
```

Both should return data. If `tools/list` returns 401, the token in the curl header doesn't match the env file.

---

## 5 — Cloudflare Tunnel (15 minutes)

Anthropic's cloud calls the MCP server, not your phone. So the server needs to be reachable from the public internet over HTTPS. Cloudflare Tunnel handles this without any router config.

### Install cloudflared

```bash
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb
sudo dpkg -i cloudflared.deb
rm cloudflared.deb
cloudflared --version
```

### Authenticate

```bash
cloudflared tunnel login
```

That prints a URL. Open it in a browser, log into Cloudflare, pick the domain you want to use. cloudflared writes a cert to `~/.cloudflared/cert.pem`.

### Create the tunnel

```bash
cloudflared tunnel create hc3-mcp
```

Note the tunnel UUID it prints.

### Configure the tunnel

```bash
mkdir -p ~/.cloudflared
cat > ~/.cloudflared/config.yml <<EOF
tunnel: <UUID-from-previous-step>
credentials-file: /home/$USER/.cloudflared/<UUID>.json

ingress:
  - hostname: mcp.your-domain.example
    service: http://127.0.0.1:3000
  - service: http_status:404
EOF
```

Substitute your tunnel UUID and your domain.

### Route the DNS

```bash
cloudflared tunnel route dns hc3-mcp mcp.your-domain.example
```

That creates a CNAME in Cloudflare's DNS pointing your subdomain at the tunnel.

### Run the tunnel as a service

```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
sudo systemctl status cloudflared
```

### Verify external reachability

From any other machine (your laptop, your phone over cellular, anything not on your LAN):

```bash
curl -s https://mcp.your-domain.example/healthz
# expect: ok
```

If that works, you're publicly reachable. If you get a "Cloudflare error" page or a timeout, check `journalctl -u cloudflared -f` for clues.

---

## 6 — Cloudflare Access (10 minutes)

Right now your `mcp.your-domain.example` is reachable from anywhere. The MCP server itself only honours valid bearer tokens, but adding a second layer in front means a leaked token alone isn't enough — the request also has to come from an authenticated source.

### Set up Cloudflare Access (Zero Trust)

1. In the Cloudflare dashboard, go to **Zero Trust** (left sidebar).
2. First time only: pick a team domain name (e.g. `your-name.cloudflareaccess.com`).
3. Go to **Access → Applications → Add an application → Self-hosted**.
4. Application name: `HC3 MCP Server`.
5. Application domain: `mcp.your-domain.example`.
6. Identity providers: enable at least one (Google, GitHub, or "One-time PIN" via email).
7. Save.

### Create the policy

8. On the new application, **Policies → Add a policy**.
9. Policy name: `Owner only`.
10. Action: **Allow**.
11. Include: **Emails → your-email@example.com**.
12. Save.

### Add a service token for Anthropic's cloud

The Claude connector won't sign in via a browser. It needs a service token:

13. **Access → Service Auth → Service Tokens → Create Service Token**.
14. Name: `claude-connector`.
15. Save. Copy the **Client ID** and **Client Secret**. You'll need them in step 7.
16. Edit your application's policy. **Add an Include rule → Service Token → claude-connector**. Save.

### Verify Access is in front of the tunnel

From a browser:
```
https://mcp.your-domain.example/healthz
```
You should now see Cloudflare Access's email-prompt screen, not the bare `ok` response. After you authenticate via email, the `ok` is shown.

From curl with both Access service-token headers and the bearer:
```bash
curl -s https://mcp.your-domain.example/healthz \
  -H "CF-Access-Client-Id: <Client ID from step 14>" \
  -H "CF-Access-Client-Secret: <Client Secret>"
# expect: ok
```

---

## 7 — Add as a custom connector at claude.ai (5 minutes)

Anthropic's cloud will now reach the Pi over the public internet, with both layers of auth.

1. Go to https://claude.ai → settings → **Connectors** (or "Integrations" depending on the UI version).
2. **Add custom connector**.
3. URL: `https://mcp.your-domain.example/mcp`
4. Authentication: choose **Custom headers** (or "Bearer token" if there's a dedicated field).
5. Add headers:
   - `Authorization: Bearer <your MCP_HTTP_TOKEN from step 3>`
   - `CF-Access-Client-Id: <Client ID from step 14>`
   - `CF-Access-Client-Secret: <Client Secret from step 14>`
6. Save and connect. Claude should fetch the tool list and show the count (~125+ tools).
7. Test from the Claude mobile app: list devices, run a small read-only tool.

---

## Operations

### Logs

```bash
journalctl -u hc3-mcp -f          # MCP server
journalctl -u cloudflared -f      # tunnel
```

### Restart after changing config

```bash
sudo systemctl restart hc3-mcp
```

### Token rotation

When you want to rotate `MCP_HTTP_TOKEN`:

```bash
NEW=$(openssl rand -hex 32)
sudo sed -i "s/^MCP_HTTP_TOKEN=.*/MCP_HTTP_TOKEN=$NEW/" /etc/hc3-mcp/.env
sudo systemctl restart hc3-mcp
# Then update the bearer token at claude.ai. Old token immediately invalid.
```

### Upgrades

```bash
# Option A users:
sudo npm install -g @northernrough/hc3-mcp-server@latest
sudo systemctl restart hc3-mcp

# Option B users:
cd /opt/hc3-mcp/src
sudo -u hc3mcp git pull
sudo -u hc3mcp npm install
sudo -u hc3mcp npm run compile
sudo systemctl restart hc3-mcp
```

### Disable mobile access temporarily

Stop the tunnel only — leave the MCP server running for any local use:

```bash
sudo systemctl stop cloudflared
```

Re-enable: `sudo systemctl start cloudflared`.

---

## Troubleshooting

### MCP server won't start

`journalctl -u hc3-mcp -n 100` — common causes:
- `MCP_HTTP_TOKEN must be set (>= 16 chars)` → token missing or too short in `.env`.
- HC3 reachability failure on startup → fix `FIBARO_HOST` / `FIBARO_USERNAME` / `FIBARO_PASSWORD`.
- Port 3000 already in use → change `MCP_HTTP_PORT` in `.env` (and the cloudflared `service:` line in `~/.cloudflared/config.yml` to match).

### Tunnel disconnected

`journalctl -u cloudflared -n 100` — typically transient. cloudflared auto-reconnects. If persistent, run `cloudflared tunnel info hc3-mcp` to check Cloudflare's view of it.

### Claude mobile says "connector unreachable"

1. From a browser: `https://mcp.your-domain.example/healthz` — does Access prompt for auth, then return `ok`?
2. With curl + Access headers + bearer: `curl https://mcp.your-domain.example/healthz` returns `ok`?
3. With curl + a tools/list: does it return JSON with tools?
4. If all of (1)-(3) work, the issue is at the connector config: re-verify the three headers you added.

### Audit who's calling

`journalctl -u hc3-mcp -f | grep "POST /mcp"` — every request logs the remote IP and JSON-RPC method (never arguments). For Cloudflare-routed traffic, the remote IP will be a Cloudflare edge IP. If you need real client IPs, enable **Add CF-Connecting-IP header** in the Cloudflare application settings.

---

## What this guide does NOT cover

- TLS termination on the Pi itself (Cloudflare handles it; the link from cloudflared edge to your Pi is internal to Cloudflare's network).
- Multi-user Access policies (this guide is single-owner; the mechanism extends to teams trivially).
- Backups of the Pi config (the only state worth keeping is `/etc/hc3-mcp/.env` and `~/.cloudflared/`).
- High availability (a single Pi 5 is fine for personal use; if you need HA, run two `cloudflared` instances against the same tunnel UUID and load-balance).

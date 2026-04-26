# Deploying HC3 MCP Server on a Raspberry Pi 5 with Cloudflare Tunnel

Step-by-step guide for running this MCP server as a long-lived HTTP service on a Pi, reachable from Anthropic's cloud (so it can be used from the Claude mobile app or claude.ai web) without exposing any router ports or managing TLS certificates.

This guide assumes:
- A Raspberry Pi 5 with Pi OS 64-bit (Bookworm or later) freshly installed and updated.
- Network access from the Pi to your HC3 (e.g. both on the same LAN).
- A Cloudflare account with a domain whose DNS is hosted on Cloudflare. The free tier is sufficient throughout.
- Git installed on the Pi (it usually is); a local clone of this repo at `/opt/hc3-mcp/src`. Optional alternative: install the published npm package globally instead.

If you only want local desktop use (Claude Desktop / Claude Code on your Mac), **you don't need any of this**. The default stdio transport is sufficient there. This guide is specifically for the always-on HTTP path.

### Pick an auth posture before you start

There are two valid deployment shapes for the HTTP transport, and they pick different tools at the door.

**Shape A — bearer on the MCP server, optional Cloudflare Access.** The MCP server requires `Authorization: Bearer <MCP_HTTP_TOKEN>` on every request. Use this when your client *can* send a static `Authorization` header — that includes `curl`, custom scripts, the OpenAI Responses API, and most desktop MCP clients via local stdio (which never go over HTTP anyway). This was the only mode supported by 3.2.x. **Does not work with claude.ai's "Add custom connector" UI**, which only supports OAuth 2.1 with Dynamic Client Registration and cannot send a static bearer.

**Shape B — unauthenticated MCP origin, Cloudflare Access as the sole identity layer.** The MCP server runs with `MCP_HTTP_ALLOW_UNAUTH=true`, accepting any request that reaches it. Cloudflare Access in front of the tunnel enforces who can actually reach it — service tokens for cloud callers (claude.ai), SSO for browsers. Use this when your client cannot send a static bearer (notably **claude.ai's custom connector**). Available in 3.3.0 and later.

Shape B trades the MCP-layer bearer for a Cloudflare-layer policy. It is **only** safe behind Cloudflare Access (or equivalent reverse-proxy auth) — the MCP server itself stops checking identity and is binding to `127.0.0.1` only as the sole network defence. Picking this shape means your security boundary is the Cloudflare edge.

This guide walks you through both. Section 3 has the choice point and tells you which env vars to set.

---

## 1 — Pi base setup (10 minutes)

### Update and install prerequisites

```bash
sudo apt update && sudo apt full-upgrade -y
sudo apt install -y curl git
sudo reboot   # if a kernel or libc upgrade pulled in
```

(`sudo apt update && upgrade` is wrong — bash runs `upgrade` as you, which doesn't exist. Each half needs its own `sudo`. `full-upgrade` lets apt pull in new dependencies, which on a long-lived box is what you want.)

### Disable any host-side VPN routing for this session

If your Mac (the machine you'll be `ssh`'ing from) is running **NordVPN, Tailscale exit-node mode, ProtonVPN, or any other full-tunnel VPN client**, disconnect it for the duration of this work. Those clients install a default route through their tunnel interface that takes precedence over your LAN, and `ssh wazzer@10.0.1.10` returns `No route to host` even though the Pi is right there.

You can confirm with `netstat -rn -f inet | head` on macOS — if you see two `default` lines and the first one is `link#NN ... utunNN`, your VPN is hijacking LAN traffic. Quit the VPN app, the second `default` line (via `10.0.1.1` on `en0`) takes over.

This is not a problem on the Pi itself — only on the machine you're using to set the Pi up.

### Install Node.js 20 LTS

The package version Pi OS ships is too old. Use NodeSource's ARM64 build:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version   # should print v20.x
npm --version
```

### Check what's already on the ports we want

The MCP server defaults to port 3000, but other Node services (Homebridge, Node-RED, Grafana, Flipdot, custom side projects) often grab 3000 too. Before going further, see what's there:

```bash
sudo ss -tlnp | grep -E ':(3000|3100)' || echo "ports 3000 and 3100 free"
```

If 3000 is taken and you don't want to touch the existing service, this guide will use **port 3100 instead**. Substitute `3100` everywhere you see `3000` below, including `MCP_HTTP_PORT=3100` in the `.env` and `service: http://127.0.0.1:3100` in the cloudflared config.

### Create a dedicated service user (no shell, no sudo)

```bash
sudo useradd --system --home-dir /var/lib/hc3-mcp --create-home --shell /usr/sbin/nologin hc3mcp
id hc3mcp   # confirm uid/gid created
```

### Create the config directory

```bash
sudo mkdir -p /etc/hc3-mcp
sudo chown root:hc3mcp /etc/hc3-mcp
sudo chmod 0750 /etc/hc3-mcp
ls -ld /etc/hc3-mcp
```

The directory is owned by root, group is the service user, mode `0750` — so root and the service user can read it, nobody else.

---

## 2 — Install the server (5 minutes)

Clone the repo into `/opt/hc3-mcp/src` and build from source. This is the recommended path: upgrades become a `git pull` instead of waiting on an npm publish, and you can roll back to any commit if a release misbehaves.

```bash
sudo mkdir -p /opt/hc3-mcp
sudo chown $USER:hc3mcp /opt/hc3-mcp
cd /opt/hc3-mcp
git clone https://github.com/northernRough/HC3_mcp.git src
cd src
npm ci
npm run compile
sudo chown -R hc3mcp:hc3mcp /opt/hc3-mcp
```

`npm ci` is preferred over `npm install` here: it installs exactly what's pinned in `package-lock.json`, is reproducible across machines, and is faster on a clean tree.

The systemd unit in section 4 assumes this path (`/opt/hc3-mcp/src/out/mcp/hc3-mcp-server.js`).

### Alternative: install the published npm package

If you'd rather not keep a working tree on the Pi, you can install the published package globally:

```bash
sudo npm install -g @northernrough/hc3-mcp-server
which hc3-mcp-server   # /usr/bin/hc3-mcp-server (symlink into /usr/lib/node_modules/...)
```

Trade-off: there's no `git pull` upgrade flow — you wait for the next npm publish, and you can't run an unreleased commit. If you pick this path, change the systemd unit's `ExecStart` to `/usr/bin/hc3-mcp-server` (see section 4).

---

## 3 — Configure credentials and pick your auth posture (10 minutes)

This is the choice point. **Pick Shape A or Shape B from the intro.** The only difference is the last two lines of the env file.

### Generate a strong bearer token (Shape A only)

If you're going with Shape A, generate a token now. Save it — you'll need it for client config.

```bash
openssl rand -hex 32
```

That prints a 64-character hex string. Copy it.

If you're going with Shape B, skip this step.

### Write the env file

**Critical: don't use nano on the Pi to write this file.** nano's default config has `set autoindent` on, which silently inserts leading spaces when you paste multi-line content. systemd's env-file parser ignores lines that start with whitespace, and the resulting "MCP_HTTP_TOKEN must be set" crash loop is non-obvious to diagnose. Either:

- **Use `tee` with a heredoc directly from the shell prompt** (commands below), or
- **Write the file on your Mac** and `scp` it across, then `sudo install` it on the Pi.

The `tee` heredoc method is fine if you paste the whole block in one go. If your terminal mangles multi-line pastes (some do), use the scp method.

#### Method 1 — `tee` heredoc from the Pi shell

```bash
sudo tee /etc/hc3-mcp/.env > /dev/null <<'EOF'
FIBARO_HOST=10.0.1.3
FIBARO_PORT=80
FIBARO_USERNAME=your_admin_user
FIBARO_PASSWORD=your_admin_password
MCP_TRANSPORT=http
MCP_HTTP_HOST=127.0.0.1
MCP_HTTP_PORT=3000
MCP_HTTP_TOKEN=PASTE_YOUR_TOKEN_HERE
EOF

sudo chown root:hc3mcp /etc/hc3-mcp/.env
sudo chmod 0640 /etc/hc3-mcp/.env
sudo ls -l /etc/hc3-mcp/.env   # -rw-r----- 1 root hc3mcp ...
```

The `'EOF'` (with quotes) means the shell does not interpret `$` or backticks — your password and token go through literally. Don't change the quotes.

For **Shape B**, replace the last line with:

```
MCP_HTTP_ALLOW_UNAUTH=true
```

(No `MCP_HTTP_TOKEN` line at all. Both flags can be set together — token wins, the flag is ignored — but for Shape B leave token unset.)

#### Method 2 — write on Mac, scp across

On your **Mac**, in a plain text editor (not Word, not Pages — TextEdit only after `Format → Make Plain Text`):

```
FIBARO_HOST=10.0.1.3
FIBARO_PORT=80
FIBARO_USERNAME=your_admin_user
FIBARO_PASSWORD=your_admin_password
MCP_TRANSPORT=http
MCP_HTTP_HOST=127.0.0.1
MCP_HTTP_PORT=3000
MCP_HTTP_TOKEN=your_64_char_hex_token
```

Save as `/tmp/hc3-mcp.env`. Then verify on the Mac:

```bash
cat -A /tmp/hc3-mcp.env
```

Every line should look like `KEY=value$` — no `^` (leading whitespace), no `^M$` (Windows line endings). If you see anything else, fix it before shipping.

Then ship and install:

```bash
scp /tmp/hc3-mcp.env user@pi:/tmp/
ssh user@pi
sudo install -m 0640 -o root -g hc3mcp /tmp/hc3-mcp.env /etc/hc3-mcp/.env
rm /tmp/hc3-mcp.env   # both Mac and Pi
```

### Why `MCP_HTTP_HOST=127.0.0.1` matters

The server binds only to localhost, so the only way in is via the `cloudflared` daemon running on the same machine. Port 3000 is never exposed on the LAN even before the tunnel is up. Don't change this to `0.0.0.0` unless you really mean it.

---

## 4 — Install the systemd unit (5 minutes)

Same paste-mangling caveat applies. The `tee` heredoc method works for almost everyone:

```bash
sudo tee /etc/systemd/system/hc3-mcp.service > /dev/null <<'EOF'
[Unit]
Description=HC3 MCP Server (HTTP transport)
Documentation=https://github.com/northernRough/HC3_mcp
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=hc3mcp
Group=hc3mcp
EnvironmentFile=/etc/hc3-mcp/.env
ExecStart=/usr/bin/node /opt/hc3-mcp/src/out/mcp/hc3-mcp-server.js
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

If you used the npm-install alternative in section 2, substitute `ExecStart=/usr/bin/hc3-mcp-server` in the unit above.

### Why this unit does **not** include `MemoryDenyWriteExecute=true`

Many systemd hardening guides recommend adding `MemoryDenyWriteExecute=true` to a service. **Don't** — Node's V8 engine uses a JIT compiler that needs writable+executable pages, and on aarch64 (the Pi 5 is aarch64) this flag causes V8 to terminate the process with `signal=TRAP`. The unit will look "secure" but it'll crash-loop forever. The other hardening flags above are all V8-compatible.

If you're hand-rolling a unit and seeing `Main process exited, code=killed, signal=TRAP`, this flag is the cause.

### Verify it's running

```bash
sudo systemctl status hc3-mcp --no-pager
sudo journalctl -u hc3-mcp -n 20 --no-pager
```

You should see in the logs (Shape A):

```
Fibaro HC3 MCP server running on HTTP at http://127.0.0.1:3000/mcp (bearer auth required)
HC3 reachable at 10.0.1.3:80 — softVersion 5.202.54, serial HC3-XXXXXX
```

Or (Shape B):

```
WARNING: HTTP transport running WITHOUT bearer authentication ...
Fibaro HC3 MCP server running on HTTP at http://127.0.0.1:3000/mcp (NO AUTH — external auth layer required)
HC3 reachable at 10.0.1.3:80 — softVersion 5.202.54, serial HC3-XXXXXX
```

If the **HC3 reachable** line says **FAILED**, your HC3 credentials or network are wrong. Fix the `.env` and `sudo systemctl restart hc3-mcp`.

If the unit is in `auto-restart` and the journal shows `MCP_HTTP_TOKEN must be set ...`, see the troubleshooting section — it almost always means systemd is silently dropping lines from your `.env` because of leading whitespace.

### Smoke test from the Pi

Shape A:
```bash
TOKEN=$(sudo grep ^MCP_HTTP_TOKEN= /etc/hc3-mcp/.env | cut -d= -f2)
curl -s http://127.0.0.1:3000/healthz                         # ok
curl -s -X POST http://127.0.0.1:3000/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | head -c 200                                                # JSON-RPC envelope
curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST http://127.0.0.1:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'           # 401
```

Shape B (no bearer expected):
```bash
curl -s http://127.0.0.1:3000/healthz                         # ok
curl -s -X POST http://127.0.0.1:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | head -c 200                                                # JSON-RPC envelope
```

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

That prints a URL. Open it in a browser **on a different machine** (the Pi has no GUI), log into Cloudflare, pick the domain you want to use. cloudflared writes a cert to `~/.cloudflared/cert.pem`.

### Create the tunnel

```bash
cloudflared tunnel create hc3-mcp
```

Note the tunnel UUID it prints. cloudflared also writes `~/.cloudflared/<UUID>.json`, the tunnel's credentials file.

### Configure the tunnel

```bash
sudo mkdir -p /etc/cloudflared
sudo cp ~/.cloudflared/<UUID>.json /etc/cloudflared/
sudo tee /etc/cloudflared/config.yml > /dev/null <<EOF
tunnel: <UUID-from-previous-step>
credentials-file: /etc/cloudflared/<UUID>.json

ingress:
  - hostname: mcp.your-domain.example
    service: http://127.0.0.1:3000
  - service: http_status:404
EOF
```

Substitute your tunnel UUID and your domain.

#### Why `127.0.0.1` and not `localhost`

cloudflared resolves `localhost` to `::1` (IPv6) on most modern Linux distros. Node's HTTP server, when bound to `127.0.0.1`, only accepts IPv4. The result is `dial tcp [::1]:3000: connect: connection refused` in cloudflared's logs and a generic 502 to the caller. Always use the literal `127.0.0.1` here.

### Route the DNS

```bash
cloudflared tunnel route dns hc3-mcp mcp.your-domain.example
```

That creates a CNAME in Cloudflare's DNS pointing your subdomain at the tunnel.

### Run the tunnel as a systemd service

```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
sudo systemctl status cloudflared --no-pager
sudo journalctl -u cloudflared -n 20 --no-pager
```

Expected: four `Registered tunnel connection` log lines (cloudflared opens connections to four edge POPs for redundancy). No `connection refused` errors.

### Verify external reachability

From any other machine (your laptop, your phone over cellular, anything not on your LAN):

```bash
curl -s https://mcp.your-domain.example/healthz
# expect: ok
```

If that works, you're publicly reachable. If you get a "Cloudflare error" page or a timeout, check `journalctl -u cloudflared -f` for clues.

---

## 6 — Cloudflare Access (10 minutes)

Without Access, your `mcp.your-domain.example` is reachable from anywhere. **For Shape B this is non-negotiable** — Access becomes the only auth between the public internet and a server with full read+write control of your HC3. **For Shape A it's a strongly recommended second layer** — a leaked bearer alone shouldn't be enough.

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

### Add a service token for cloud callers (claude.ai, scripts)

The Claude connector and any non-browser caller won't sign in via SSO. They need a service token:

13. **Access → Service Auth → Service Tokens → Create Service Token**.
14. Name: `claude-connector` (or per caller).
15. Save. Copy the **Client ID** and **Client Secret**. You'll need them in step 7.
16. Edit your application's policy. **Add an Include rule → Service Token → claude-connector**. Save.

### Verify Access is in front of the tunnel

From a browser:
```
https://mcp.your-domain.example/healthz
```
You should now see Cloudflare Access's email-prompt screen, not the bare `ok` response. After you authenticate via email, the `ok` is shown.

From curl with the Access service-token headers:
```bash
curl -s https://mcp.your-domain.example/healthz \
  -H "CF-Access-Client-Id: <Client ID from step 14>" \
  -H "CF-Access-Client-Secret: <Client Secret>"
# expect: ok
```

If using **Shape A**, also include the bearer:
```bash
curl -s -X POST https://mcp.your-domain.example/mcp \
  -H "CF-Access-Client-Id: <...>" \
  -H "CF-Access-Client-Secret: <...>" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  | head -c 200
```

---

## 7 — Connect a client

### claude.ai custom connector (Shape B only)

claude.ai's **Add custom connector** UI supports OAuth 2.1 with Dynamic Client Registration as the only authentication mechanism. It cannot send a static `Authorization: Bearer …` header, and there is no "Custom headers" field. This is why Shape B exists.

1. Go to https://claude.ai → settings → **Connectors**.
2. **Add custom connector**.
3. URL: `https://mcp.your-domain.example/mcp`
4. Authentication: leave OAuth Client ID and Client Secret blank (the MCP server is unauthenticated; Cloudflare Access service-token headers reach the origin via the connector's request, but claude.ai's connector doesn't expose where to put them either — Cloudflare Access policy needs to be configured to *not* require service-token headers from claude.ai's IP space, OR you accept that claude.ai must reach the endpoint without Access service-token credentials, which means Access is unset for that path).

> **Caveat — claude.ai + Cloudflare Access interaction is partly unresolved.** As of this writing, claude.ai's connector UI does not surface fields for Cloudflare Access service-token headers (`CF-Access-Client-Id`, `CF-Access-Client-Secret`). Two practical options: (a) attach a more permissive Access policy to `/mcp` that allows requests from claude.ai's IP space without service-token credentials, accepting that you've effectively turned Access off for that origin and are relying entirely on URL obscurity + Cloudflare's edge filtering; or (b) wait for claude.ai to support OAuth-via-Cloudflare-Access end-to-end (their roadmap includes this; track Cloudflare's "Browse" / "MCP Server" Access app type).
>
> If neither option appeals, use Shape A with a non-claude.ai client (claude.ai Code, custom scripts, OpenAI Responses API, etc.) for now.

5. Save. Claude should fetch the tool list and show the count (~129 tools at 3.3.0).
6. Test from the mobile or web app: list devices, run a small read-only tool.

### claude.ai custom connector — diagnostics

If claude.ai shows **"Couldn't reach the MCP server. ... reference: ofid_..."**:

- The `ofid_...` reference is opaque to outsiders but Anthropic support can map it to a specific failure.
- The server-side log will tell you what claude.ai actually sent. On the Pi, `sudo journalctl -u hc3-mcp -u cloudflared -f`, then click "Test" in claude.ai's connector UI. You'll see one of:
  - **A `[http] ... POST /mcp method=initialize` line** → claude.ai got through, server responded; problem is on claude.ai's side or the connector spec compliance.
  - **A 401 response** → the bearer wall is rejecting claude.ai. You're probably in Shape A; switch to Shape B.
  - **`dial tcp [::1]:3000: connection refused` from cloudflared** → cloudflared can't reach the Node origin. Your `config.yml` has `localhost` instead of `127.0.0.1`.
  - **No log entries at all** → cloudflared isn't even reaching the server (DNS, tunnel down, Access blocking).

### Other clients (Shape A)

Any MCP client that lets you set a custom HTTP header can use Shape A directly. Set the URL to `https://mcp.your-domain.example/mcp` and add three headers:

- `Authorization: Bearer <your MCP_HTTP_TOKEN>`
- `CF-Access-Client-Id: <your service-token Client ID>`
- `CF-Access-Client-Secret: <your service-token Client Secret>`

This works for `curl`-based scripts, custom integrations, and any MCP client with HTTP-header support.

---

## Operations

### Logs

```bash
sudo journalctl -u hc3-mcp -f          # MCP server
sudo journalctl -u cloudflared -f      # tunnel
```

### Restart after changing config

```bash
sudo systemctl restart hc3-mcp
sudo systemctl restart cloudflared    # if you changed config.yml
```

### Token rotation (Shape A)

When you want to rotate `MCP_HTTP_TOKEN`:

```bash
NEW=$(openssl rand -hex 32)
sudo sed -i "s/^MCP_HTTP_TOKEN=.*/MCP_HTTP_TOKEN=$NEW/" /etc/hc3-mcp/.env
sudo systemctl restart hc3-mcp
echo "New token: $NEW"
# Update wherever the bearer is configured (client config, Access service tokens stay the same).
# The old token is invalid as soon as systemctl restart finishes.
```

### Service token rotation (Shape B)

Cloudflare Access → Service Auth → rotate or recreate the token. Update wherever the new ID/secret are needed. The MCP server doesn't need to restart — Access enforces this at the edge.

### Upgrades

For a git-clone install (the default in section 2):

```bash
cd /opt/hc3-mcp/src
sudo -u hc3mcp git pull
sudo -u hc3mcp npm ci
sudo -u hc3mcp npm run compile
sudo systemctl restart hc3-mcp
sudo journalctl -u hc3-mcp -n 5 --no-pager
```

The repo ships a wrapper that does exactly this: `sudo /opt/hc3-mcp/src/scripts/pi-update.sh`. One command, same effect, plus a brief journal tail at the end so you can confirm the "running on HTTP" / "HC3 reachable" banner.

For an npm-install upgrade (alternative path):

```bash
sudo npm install -g @northernrough/hc3-mcp-server@latest
sudo systemctl restart hc3-mcp
```

After upgrading either way, watch journalctl for the smoke-test line so you know HC3 is still reachable.

### Disable mobile access temporarily

Stop the tunnel only — leave the MCP server running for any local use:

```bash
sudo systemctl stop cloudflared
```

Re-enable: `sudo systemctl start cloudflared`.

---

## Troubleshooting

### MCP server won't start

`sudo journalctl -u hc3-mcp -n 100` — common causes:

- **`MCP_HTTP_TOKEN must be set ...`** with the env file containing the token correctly:
  - The unit or env file has **leading whitespace** on its lines. systemd's parsers silently drop indented lines. `sudo cat -A /etc/hc3-mcp/.env` and `sudo cat -A /etc/systemd/system/hc3-mcp.service` — every line should start with the directive name, not with a `^I` (tab) or space. Rewrite using `sudo tee` with a heredoc, **not** `nano` (which auto-indents pasted content).
  - The token line is **commented out**. `cat -A` shows a `#` at the start of the line.
- **HC3 reachability failure on startup** → fix `FIBARO_HOST` / `FIBARO_USERNAME` / `FIBARO_PASSWORD`.
- **Port 3000 already in use** → another service has it. Pick port 3100, change `MCP_HTTP_PORT` in `.env`, change the cloudflared `service:` line in `/etc/cloudflared/config.yml` to match.
- **`code=killed, signal=TRAP`** on aarch64 (Pi 5) → your unit has `MemoryDenyWriteExecute=true`. Remove that line.
- **`Main process exited, code=exited, status=203/EXEC`** → wrong `ExecStart` path. `which hc3-mcp-server` and use that.

### claude.ai connector says "Couldn't reach the MCP server"

The error is generic; the cause is one of:
- Origin is unreachable from cloudflared (logs show `connection refused` — fix `localhost` → `127.0.0.1`).
- Origin returns 401 because the bearer wall is on (logs show `[http] ... POST /mcp method=...` followed by a 401 response). Switch to Shape B with `MCP_HTTP_ALLOW_UNAUTH=true`.
- Cloudflare Access is rejecting claude.ai (Access logs in dashboard → Zero Trust → Logs → Access).
- DNS hasn't propagated for `mcp.your-domain.example` yet (rare; takes a few minutes after `cloudflared tunnel route dns`).

`sudo journalctl -u hc3-mcp -u cloudflared -f`, then click "Test" in claude.ai. The next 5 seconds of logs tell you where the request actually died.

### Tunnel disconnected

`sudo journalctl -u cloudflared -n 100` — typically transient. cloudflared auto-reconnects. If persistent, run `cloudflared tunnel info hc3-mcp` to check Cloudflare's view of it.

### `ssh user@pi` returns "No route to host" from your Mac

A VPN client on your Mac is hijacking the LAN route. NordVPN, Tailscale exit-node, ProtonVPN, corporate VPN clients all do this. `netstat -rn -f inet | head` on macOS — if the first `default` line is `link#NN ... utunNN`, that's the culprit. Quit the VPN app for the duration of this session.

### Audit who's calling

`sudo journalctl -u hc3-mcp -f | grep "POST /mcp"` — every request logs the remote IP and JSON-RPC method (never arguments). For Cloudflare-routed traffic, the remote IP will be a Cloudflare edge IP. If you need real client IPs, enable **Add CF-Connecting-IP header** in the Cloudflare application settings.

---

## What this guide does NOT cover

- TLS termination on the Pi itself (Cloudflare handles it; the link from cloudflared edge to your Pi is internal to Cloudflare's network).
- Multi-user Access policies (this guide is single-owner; the mechanism extends to teams trivially).
- Backups of the Pi config (the only state worth keeping is `/etc/hc3-mcp/.env`, `/etc/cloudflared/config.yml`, and `/etc/cloudflared/<UUID>.json`).
- High availability (a single Pi 5 is fine for personal use; if you need HA, run two `cloudflared` instances against the same tunnel UUID and load-balance).
- DNS migration if your domain isn't already on Cloudflare. You need the zone served by Cloudflare nameservers (`*.ns.cloudflare.com`) before `cloudflared tunnel route dns` works. If you're moving from another DNS provider, do that migration as a separate task with care for MX/SPF/DKIM continuity.

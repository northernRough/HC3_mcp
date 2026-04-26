# Security policy

## Supported versions

Only the **latest published version** on npm is supported. If you find an issue against an older release, please reproduce it against the latest version before reporting.

## Trust model

`hc3-mcp-server` runs locally with your Fibaro HC3 admin credentials and exposes an MCP-protocol surface to whatever client (Claude Code, Claude Desktop, Cursor, Cline, etc.) you connect it to. That client is then able to:

- Read every device, scene, QuickApp, global variable, custom event, profile, room, user, and notification on your HC3.
- Mutate the same. Tools are write-capable, including `delete_device`, `delete_global_variable`, `delete_room`, `delete_profile`, `delete_custom_event`, `delete_notification`, `update_user_rights`, `modify_device`, `update_quickapp_file`, `set_quickapp_variable`, and many others.
- Run scenes and execute device actions.

You are giving the agent the same operational power you have over the HC3. Treat the credentials, and the agent's instructions, accordingly.

## Credential handling

- Credentials are read from environment variables (`FIBARO_HOST`, `FIBARO_USERNAME`, `FIBARO_PASSWORD`, optionally `FIBARO_PORT`). They are never written to disk by this code.
- The published npm tarball does **not** contain `.env`, `CLAUDE.md`, `.claude/`, or any other local configuration. Contents are limited to compiled JS, `LICENSE`, `README.md`, `CHANGELOG.md`, `SECURITY.md`, and `DEPLOYMENT.md`.
- Credentials are sent to the HC3 over Basic auth. HC3 does not support TLS on its REST surface in current firmware; assume the host-to-HC3 link is local and trusted, or front it with a reverse proxy.

## HTTP transport (3.2.0+)

The optional HTTP transport (`MCP_TRANSPORT=http`) exposes the MCP server over a network socket. It supports two security postures, both of which are valid; they make different assumptions about where the security boundary lives.

- **Bearer-protected (default).** Set `MCP_HTTP_TOKEN` to a 16+-character secret. Every request to `/mcp` must carry `Authorization: Bearer <token>`; mismatches return 401. Comparison is constant-time (`crypto.timingSafeEqual`). The token is the only secret that needs to be issued to clients; it does not authenticate users, just callers. Token rotation procedure is in `DEPLOYMENT.md`.
- **Unauthenticated origin (3.3.0+).** Set `MCP_HTTP_ALLOW_UNAUTH=true` and leave `MCP_HTTP_TOKEN` unset. The server logs a loud warning at startup and accepts requests on `/mcp` with no header check. **This is only safe when an external authentication layer enforces identity** — Cloudflare Access service tokens, a reverse proxy with auth, or strict firewall rules. Picking this mode shifts the entire security boundary off the MCP server and onto that external layer. Anyone who reaches `MCP_HTTP_HOST:MCP_HTTP_PORT` directly has full read+write control of the HC3 (device control, scene execution, QuickApp edits, global variable writes). This mode exists because some MCP clients — notably claude.ai's "Add custom connector" UI — only support OAuth 2.1 with Dynamic Client Registration and cannot send a static `Authorization: Bearer` header. Without this option, those clients are blocked by the bearer wall.

The server refuses to start in HTTP mode when neither flag is set, to make the choice deliberate.

Either posture leaves the network shape unchanged: bind to `127.0.0.1` so the only way in is via a same-host process (cloudflared, a reverse proxy, etc.); the 1 MB request-body cap and SSE keep-alive behaviour are identical. Request logs include the JSON-RPC method name but never request arguments (which can carry credentials).

## Reporting a vulnerability

Email **dev@cheetham.org** with:

- A description of the issue and where you found it (file path, tool name, or specific request shape).
- A minimal reproduction.
- Your assessment of the impact and any sensitive data the issue could expose.

Please **do not** open public GitHub issues for security findings. I'll acknowledge within 7 days and keep you in the loop on the fix and disclosure timeline.

If a fix involves a coordinated disclosure, I'll publish a GitHub Security Advisory on the repo at the time of the patch release.

## What is in scope

- Bugs in `hc3-mcp-server` that allow an unintended write to HC3 state, that leak credentials, or that misrepresent the success of a write (silent failure).
- Issues in the published npm package metadata or tarball contents.

## What is out of scope

- HC3 firmware bugs (report those to Fibaro).
- Issues in the underlying MCP protocol (report to the protocol maintainers).
- Issues in MCP clients that consume this server (report to the client author).
- Use of the server with credentials the user does not own (this is a deployment concern, not a server bug).

## Maintenance posture

This package is maintained for the author's personal HC3 setup and is published as-is for the wider Fibaro community. There is no SLA. Bug reports and PRs are welcome but response time is best-effort.

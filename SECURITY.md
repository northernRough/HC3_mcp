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
- The published npm tarball does **not** contain `.env`, `CLAUDE.md`, `.claude/`, or any other local configuration. Contents are limited to compiled JS, `LICENSE`, `README.md`, and `CHANGELOG.md`.
- Credentials are sent to the HC3 over Basic auth. HC3 does not support TLS on its REST surface in current firmware; assume the host-to-HC3 link is local and trusted, or front it with a reverse proxy.

## Reporting a vulnerability

Email **nick@mallorn.ltd** with:

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

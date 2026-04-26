# MCP client configuration

The canonical configuration docs live alongside the source:

- **stdio transport (Claude Desktop, Claude Code, Cursor, Cline, Continue, etc.)**
  See the **Configure your MCP client** section of [`README.md`](./README.md).
  This is the default transport and works for any client that can spawn a local
  MCP server process. Configuration is a small JSON snippet pointing at
  `hc3-mcp-server` (or `node /path/to/out/mcp/hc3-mcp-server.js`) with
  `FIBARO_HOST`, `FIBARO_USERNAME`, `FIBARO_PASSWORD` (and optional
  `FIBARO_PORT`) in the `env` block.

- **HTTP transport + custom connector at claude.ai (web / mobile)**
  See [`DEPLOYMENT.md`](./DEPLOYMENT.md). It walks through running the
  server as a hardened systemd service, fronting it with a Cloudflare
  Tunnel, locking it down with Cloudflare Access service tokens, and
  adding the resulting `https://...` endpoint as a custom connector in
  the claude.ai settings UI so the server is reachable from Claude on
  the web and mobile apps.

Old VS Code Copilot extension instructions that lived here have been
removed: the extension scaffolding was dropped in 3.0.0 when this fork
became a standalone npm package. Any MCP-aware client works out of the
box — there is no Fibaro-specific extension to install on the client
side.

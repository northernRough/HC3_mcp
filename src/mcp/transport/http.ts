// HTTP transport for MCP, intended for long-lived hosts (Pi, container)
// fronted by Cloudflare Tunnel + Access for remote claude.ai connector use.
//
// Endpoints:
//   POST /mcp     — JSON-RPC envelope in, JSON-RPC envelope out (or 202 on
//                   notifications). 1 MB body cap.
//   GET  /mcp     — SSE stream for server-pushed messages (keep-alive only).
//   GET  /healthz — unauthenticated readiness probe.
//
// Auth: Bearer token via MCP_HTTP_TOKEN (>=16 chars, constant-time compared).
// Token-less mode requires explicit MCP_HTTP_ALLOW_UNAUTH=true and assumes an
// external auth layer (Cloudflare Access etc.); the server logs a loud
// warning at startup and the readiness banner reflects the mode.
//
// Extracted from hc3-mcp-server.ts. Behaviour is byte-identical to the
// previous in-class setupHttpHandler.

import { MCPResponse } from '../types';
import { HC3Client } from '../hc3-client';

type Dispatch = (line: string) => Promise<MCPResponse | null>;

export function setupHttp(opts: { dispatch: Dispatch; hc3: HC3Client }): void {
  const { dispatch, hc3 } = opts;
  const http = require('node:http') as typeof import('node:http');
  const host = process.env.MCP_HTTP_HOST ?? '127.0.0.1';
  const port = process.env.MCP_HTTP_PORT ? parseInt(process.env.MCP_HTTP_PORT) : 3000;
  const expected = process.env.MCP_HTTP_TOKEN;
  const allowUnauth = (process.env.MCP_HTTP_ALLOW_UNAUTH ?? '').toLowerCase() === 'true';
  const haveToken = !!expected && expected.length >= 16;
  if (!haveToken && !allowUnauth) {
    console.error('MCP_HTTP_TOKEN must be set (>= 16 chars) when MCP_TRANSPORT=http, or set MCP_HTTP_ALLOW_UNAUTH=true to disable bearer auth (only safe behind an external auth layer such as Cloudflare Access). Refusing to start.');
    process.exit(1);
  }
  if (!haveToken && allowUnauth) {
    console.error('WARNING: HTTP transport running WITHOUT bearer authentication (MCP_HTTP_ALLOW_UNAUTH=true). The MCP server has full read+write control of HC3. Anyone able to reach this endpoint can fully control your HC3, including device control, scene execution, QuickApp edits, and global variable writes. Ensure an external authentication layer (Cloudflare Access, reverse proxy auth, firewall rules) is enforcing identity.');
  }
  const expectedBuf = haveToken ? Buffer.from(expected!, 'utf8') : Buffer.alloc(0);

  const constantTimeEq = (a: string): boolean => {
    const ab = Buffer.from(a, 'utf8');
    if (ab.length !== expectedBuf.length) return false;
    const crypto = require('node:crypto') as typeof import('node:crypto');
    return crypto.timingSafeEqual(ab, expectedBuf);
  };

  const writeJson = (res: import('node:http').ServerResponse, status: number, body: any) => {
    const text = JSON.stringify(body);
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(text),
    });
    res.end(text);
  };

  const server = http.createServer(async (req, res) => {
    const url = req.url ?? '';
    const method = req.method ?? 'GET';

    if (method === 'GET' && url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok\n');
      return;
    }

    // Bearer auth on every other path, unless explicitly disabled via
    // MCP_HTTP_ALLOW_UNAUTH=true. When disabled, identity is expected to be
    // enforced by an external layer (Cloudflare Access, reverse proxy, firewall).
    if (haveToken) {
      const authHeader = req.headers['authorization'];
      const supplied = typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7).trim()
        : '';
      if (!supplied || !constantTimeEq(supplied)) {
        writeJson(res, 401, { error: 'unauthorized' });
        return;
      }
    }

    if (method === 'GET' && url === '/mcp') {
      // SSE stream for server-initiated messages and notifications.
      // Held open with periodic keep-alive comments. Currently the server
      // does not push notifications proactively, so this is mostly a
      // protocol-conformance stub clients can subscribe to.
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-store',
        'Connection': 'keep-alive',
      });
      res.write(': hc3-mcp sse stream\n\n');
      const ka = setInterval(() => res.write(': ka\n\n'), 25000);
      req.on('close', () => clearInterval(ka));
      return;
    }

    if (method === 'POST' && url === '/mcp') {
      // Read body with a 1 MB cap.
      const chunks: Buffer[] = [];
      let total = 0;
      const MAX = 1024 * 1024;
      let aborted = false;
      req.on('data', (c: Buffer) => {
        total += c.length;
        if (total > MAX) {
          aborted = true;
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on('end', async () => {
        if (aborted) {
          writeJson(res, 413, { error: 'payload too large' });
          return;
        }
        const body = Buffer.concat(chunks).toString('utf8');
        // Log without arguments (which can contain credentials).
        let methodForLog = '?';
        try { methodForLog = JSON.parse(body).method ?? '?'; } catch {}
        console.error(`[http] ${req.socket.remoteAddress} POST /mcp method=${methodForLog} ${total}b`);

        const response = await dispatch(body);
        if (response === null) {
          // Notification — no body, 202 Accepted per MCP spec convention.
          res.writeHead(202).end();
          return;
        }
        writeJson(res, 200, response);
      });
      req.on('error', () => {
        if (!res.headersSent) writeJson(res, 400, { error: 'bad request' });
      });
      return;
    }

    writeJson(res, 404, { error: 'not found' });
  });

  server.listen(port, host, () => {
    const authMode = haveToken ? 'bearer auth required' : 'NO AUTH — external auth layer required';
    console.error(`Fibaro HC3 MCP server running on HTTP at http://${host}:${port}/mcp (${authMode})`);
    // Startup smoke test: confirm HC3 reachability so that a misconfigured
    // .env shows up in the logs immediately, not only on first user request.
    void hc3.request('/api/settings/info')
      .then((info: any) => {
        const v = info?.softVersion ?? '?';
        const sn = info?.serialNumber ?? '?';
        console.error(`HC3 reachable at ${hc3.config.host}:${hc3.config.port} — softVersion ${v}, serial ${sn}`);
      })
      .catch((e: any) => {
        console.error(`HC3 reachability check FAILED: ${e?.message ?? e}. Server is running but tool calls will fail until HC3 credentials/network are correct.`);
      });
  });
}

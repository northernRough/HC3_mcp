// Minimal stdio MCP client for testing the HC3_mcp server.
// Spawns the compiled server, exchanges JSON-RPC over stdio.

import { spawn } from 'node:child_process';

export class MCPClient {
    constructor({ serverPath, env = process.env } = {}) {
        this.proc = spawn('node', [serverPath], {
            env,
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        this.proc.stderr.on('data', d => process.stderr.write(`[server] ${d}`));
        this.buf = '';
        this.pending = new Map();
        this.id = 0;
        this.proc.stdout.on('data', d => {
            this.buf += d.toString();
            let nl;
            while ((nl = this.buf.indexOf('\n')) !== -1) {
                const line = this.buf.slice(0, nl).trim();
                this.buf = this.buf.slice(nl + 1);
                if (!line) continue;
                let msg;
                try { msg = JSON.parse(line); } catch { continue; }
                const cb = this.pending.get(msg.id);
                if (cb) { this.pending.delete(msg.id); cb(msg); }
            }
        });
        this.proc.on('exit', code => {
            for (const cb of this.pending.values()) cb({ error: { code: -32000, message: `server exited ${code}` } });
            this.pending.clear();
        });
    }

    rpc(method, params, timeoutMs = 30000) {
        const id = ++this.id;
        return new Promise((resolve, reject) => {
            const t = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`timeout: ${method}`));
            }, timeoutMs);
            this.pending.set(id, msg => { clearTimeout(t); resolve(msg); });
            this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
        });
    }

    async initialize() {
        return this.rpc('initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'hc3-mcp-test-harness', version: '1.0' },
        });
    }

    close() { this.proc.kill(); }
}

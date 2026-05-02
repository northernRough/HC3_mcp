#!/usr/bin/env node
// Captures the full tools/list response for byte-diff regression checks.
// Usage: node scripts/snapshot-tools-list.mjs <out-file>

import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const outFile = resolve(process.argv[2] ?? 'tools-list-snapshot.json');

const child = spawn('node', [resolve('out/mcp/hc3-mcp-server.js')], {
  env: { ...process.env, FIBARO_HOST: 'stub', FIBARO_USERNAME: 'stub', FIBARO_PASSWORD: 'stub' },
  stdio: ['pipe', 'pipe', 'inherit'],
});

let buf = '';
const responses = [];
child.stdout.on('data', (chunk) => {
  buf += chunk.toString('utf8');
  let nl;
  while ((nl = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (line) responses.push(JSON.parse(line));
  }
});

const done = new Promise((r) => child.on('close', r));

const rpc = (method, params, id) =>
  JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';

child.stdin.write(rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'snap', version: '0' } }, 0));
child.stdin.write(rpc('tools/list', {}, 1));
child.stdin.end();

await done;

const list = responses.find((r) => r.id === 1);
writeFileSync(outFile, JSON.stringify(list, null, 2));
console.error(`wrote tools/list (${list?.result?.tools?.length} tools) to ${outFile}`);

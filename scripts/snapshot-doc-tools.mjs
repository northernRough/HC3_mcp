#!/usr/bin/env node
// Drives the compiled stdio server with a fixed list of tools/call requests
// for the four get_hc3_*_guide doc tools across every documented topic
// (plus 'all', plus a missing arg, plus an unknown arg). Writes the JSON
// responses to a single file so before/after refactors can byte-diff.
//
// Usage: node scripts/snapshot-doc-tools.mjs <out-file>
//
// HC3 creds are not required — the doc tools are pure-data and never hit HC3.

import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const outFile = resolve(process.argv[2] ?? 'doc-snapshot.json');

const cases = [
  // get_hc3_configuration_guide
  ['get_hc3_configuration_guide', {}],
  ['get_hc3_configuration_guide', { topic: 'all' }],
  ['get_hc3_configuration_guide', { topic: 'network' }],
  ['get_hc3_configuration_guide', { topic: 'users' }],
  ['get_hc3_configuration_guide', { topic: 'rooms' }],
  ['get_hc3_configuration_guide', { topic: 'zwave' }],
  ['get_hc3_configuration_guide', { topic: 'time' }],
  ['get_hc3_configuration_guide', { topic: 'location' }],
  ['get_hc3_configuration_guide', { topic: 'voip' }],
  ['get_hc3_configuration_guide', { topic: 'nonsense' }],
  // get_hc3_quickapp_programming_guide
  ['get_hc3_quickapp_programming_guide', {}],
  ['get_hc3_quickapp_programming_guide', { topic: 'all' }],
  ['get_hc3_quickapp_programming_guide', { topic: 'basic' }],
  ['get_hc3_quickapp_programming_guide', { topic: 'methods' }],
  ['get_hc3_quickapp_programming_guide', { topic: 'http' }],
  ['get_hc3_quickapp_programming_guide', { topic: 'tcp' }],
  ['get_hc3_quickapp_programming_guide', { topic: 'udp' }],
  ['get_hc3_quickapp_programming_guide', { topic: 'websocket' }],
  ['get_hc3_quickapp_programming_guide', { topic: 'mqtt' }],
  ['get_hc3_quickapp_programming_guide', { topic: 'child_devices' }],
  ['get_hc3_quickapp_programming_guide', { topic: 'nonsense' }],
  // get_hc3_lua_scenes_guide
  ['get_hc3_lua_scenes_guide', {}],
  ['get_hc3_lua_scenes_guide', { topic: 'all' }],
  ['get_hc3_lua_scenes_guide', { topic: 'conditions' }],
  ['get_hc3_lua_scenes_guide', { topic: 'triggers' }],
  ['get_hc3_lua_scenes_guide', { topic: 'actions' }],
  ['get_hc3_lua_scenes_guide', { topic: 'examples' }],
  ['get_hc3_lua_scenes_guide', { topic: 'api' }],
  ['get_hc3_lua_scenes_guide', { topic: 'nonsense' }],
  // get_hc3_programming_examples
  ['get_hc3_programming_examples', {}],
  ['get_hc3_programming_examples', { category: 'all' }],
  ['get_hc3_programming_examples', { category: 'lighting' }],
  ['get_hc3_programming_examples', { category: 'security' }],
  ['get_hc3_programming_examples', { category: 'climate' }],
  ['get_hc3_programming_examples', { category: 'scenes' }],
  ['get_hc3_programming_examples', { category: 'devices' }],
  ['get_hc3_programming_examples', { category: 'mqtt' }],
  ['get_hc3_programming_examples', { category: 'tcp' }],
  ['get_hc3_programming_examples', { category: 'nonsense' }],
];

function rpc(method, params, id) {
  return JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
}

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

const done = new Promise((resolveDone) => {
  child.on('close', () => resolveDone());
});

// initialize → tools/call ×N → exit
child.stdin.write(rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'snap', version: '0' } }, 0));
cases.forEach(([name, args], i) => {
  child.stdin.write(rpc('tools/call', { name, arguments: args }, i + 1));
});
child.stdin.end();

await done;

// Drop the initialize response (idx 0); keep the tools/call results in case order.
const calls = responses.filter((r) => typeof r.id === 'number' && r.id >= 1).sort((a, b) => a.id - b.id);
const out = calls.map((r, i) => ({ case: cases[i], response: r }));

writeFileSync(outFile, JSON.stringify(out, null, 2));
console.error(`wrote ${out.length} responses to ${outFile}`);
